import * as path from "node:path";
import { FolderNameCache } from "../library/folder-names.js";
import type { Logger } from "../shared/logger.js";
import {
    borrowFolderCover,
    FolderCovers,
    type CoverSharing,
} from "./folder-covers.js";
import { processTrack, type ProcessingContext } from "./processing.js";
import { renameTrack } from "./rename.js";
import type {
    FileStatus,
    ProcessedTrack,
    ProcessingReport,
    ProcessingStats,
    TrackStatus,
} from "./types.js";

export const MAX_FILES_PER_RUN = 3000;

export function createReport(
    files: string[],
    sourceRoot: string
): ProcessingReport {
    return {
        files: Object.fromEntries(
            files.map((file) => [path.relative(sourceRoot, file), "READ"])
        ),
    };
}

function logTrackHeader(
    position: string,
    source: string,
    logger: Logger
): void {
    logger.info(`\n${position}`);
    logger.info(`Format: ${path.extname(source).slice(1).toUpperCase()}`);
}

export interface BatchRun {
    context: ProcessingContext;
    report: ProcessingReport;
    stopSignal: AbortSignal;
    renameFiles: boolean;
    onTrackProcessed?: (result: ProcessedTrack) => void;
}

interface ActiveBatch extends BatchRun {
    folderNames: FolderNameCache;
    processed: ProcessedTrack[];
}

function recordRename(
    source: string,
    destination: string,
    run: BatchRun
): void {
    const { sourceRoot } = run.context;
    const renamed = (run.report.renamed ??= {});
    renamed[path.relative(sourceRoot, source)] = path.relative(
        sourceRoot,
        destination
    );
}

async function renameProcessedFile(
    source: string,
    status: TrackStatus,
    run: ActiveBatch
): Promise<string | null> {
    if (!run.renameFiles) {
        return null;
    }

    const destination = await renameTrack(source, status, {
        folderNames: run.folderNames,
        logger: run.context.logger,
    });

    if (destination) {
        recordRename(source, destination, run);
    }

    return destination;
}

async function processFile(
    source: string,
    position: string,
    run: ActiveBatch
): Promise<void> {
    const relativePath = path.relative(run.context.sourceRoot, source);
    logTrackHeader(`[${position}] ${relativePath}`, source, run.context.logger);
    const status = await processTrack(source, run.context);
    run.report.files[relativePath] = status;
    const destination = await renameProcessedFile(source, status, run);
    run.folderNames.markProcessed(source);
    announceTrack({ source, status, destination }, run);
}

function announceTrack(track: ProcessedTrack, run: ActiveBatch): void {
    run.processed.push(track);
    run.onTrackProcessed?.(track);
}

async function processFiles(files: string[], run: ActiveBatch): Promise<void> {
    for (const [index, source] of files.entries()) {
        if (run.stopSignal.aborted) {
            run.context.logger.info(
                "Stopped before processing the remaining files."
            );
            return;
        }

        await processFile(source, `${index + 1}/${files.length}`, run);
    }
}

async function markTaggedByCover(
    { source, status }: ProcessedTrack,
    run: ActiveBatch
): Promise<void> {
    if (status !== "SKIPPED") {
        return;
    }

    run.report.files[path.relative(run.context.sourceRoot, source)] = "TAGGED";
    // The track itself was not found, so its tags stay unverified.
    const destination = await renameProcessedFile(source, "SKIPPED", run);
    run.onTrackProcessed?.({ source, status: "TAGGED", destination });
}

async function shareFolderCover(
    track: ProcessedTrack,
    sharing: CoverSharing,
    run: ActiveBatch
): Promise<void> {
    const current = track.destination ?? track.source;

    if (await borrowFolderCover(current, sharing)) {
        await markTaggedByCover(track, run);
    }
}

function logCoverSharingStart(candidates: ProcessedTrack[], logger: Logger) {
    if (candidates.length > 0) {
        logger.info("\nSharing covers between tracks of the same album...");
    }
}

async function shareFolderCovers(run: ActiveBatch): Promise<void> {
    const { sourceRoot, logger } = run.context;
    const sharing = { folderCovers: new FolderCovers(), sourceRoot, logger };
    const candidates = run.processed.filter(
        ({ status }) => status !== "FAILED"
    );
    logCoverSharingStart(candidates, logger);

    for (const track of candidates) {
        if (run.stopSignal.aborted) {
            logger.info("Stopped before sharing the remaining covers.");
            return;
        }

        await shareFolderCover(track, sharing, run);
    }
}

async function shareFolderCoversUnlessStopped(run: ActiveBatch): Promise<void> {
    if (!run.stopSignal.aborted) {
        await shareFolderCovers(run);
    }
}

export async function processBatch(
    files: string[],
    run: BatchRun
): Promise<void> {
    const folderNames = new FolderNameCache(files);
    const batch: ActiveBatch = { ...run, folderNames, processed: [] };

    try {
        await processFiles(files, batch);
        await shareFolderCoversUnlessStopped(batch);
    } finally {
        folderNames.clear();
        run.context.metadataChain.clearCache();
    }
}

export function countStatuses(report: ProcessingReport): ProcessingStats {
    const statuses = Object.values(report.files);
    const count = (status: FileStatus) =>
        statuses.filter((fileStatus) => fileStatus === status).length;

    return {
        ok: count("TAGGED"),
        skipped: count("SKIPPED"),
        errors: count("FAILED"),
        unprocessed: count("READ"),
    };
}
