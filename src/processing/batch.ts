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
import type { StoredTags } from "../tags/types.js";
import type {
    FileStatus,
    ProcessedTrack,
    ProcessingTrack,
    ProcessingReport,
    ProcessingStats,
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

interface BatchTrack extends ProcessingTrack {
    destination: string | null;
}

interface TaggedTrack extends BatchTrack {
    tags: StoredTags;
}

function hasTags(track: BatchTrack): track is TaggedTrack {
    return track.tags !== null;
}

interface ActiveBatch extends BatchRun {
    folderNames: FolderNameCache;
    processed: BatchTrack[];
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
    track: ProcessingTrack,
    run: ActiveBatch
): Promise<string | null> {
    if (!run.renameFiles) {
        return null;
    }

    const destination = await renameTrack(track, {
        folderNames: run.folderNames,
        logger: run.context.logger,
    });

    if (destination) {
        recordRename(track.source, destination, run);
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
    const track = { source, ...(await processTrack(source, run.context)) };
    run.report.files[relativePath] = track.status;
    const destination = await renameProcessedFile(track, run);
    run.folderNames.markProcessed(source);
    announceTrack({ ...track, destination }, run);
}

function announceTrack(track: BatchTrack, run: ActiveBatch): void {
    const { source, status, destination } = track;
    run.processed.push(track);
    run.onTrackProcessed?.({ source, status, destination });
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
    { source, status }: BatchTrack,
    tags: StoredTags,
    run: ActiveBatch
): Promise<void> {
    if (status !== "SKIPPED") {
        return;
    }

    run.report.files[path.relative(run.context.sourceRoot, source)] = "TAGGED";
    const withCover = { ...tags, hasCover: true };
    // The track itself was not found, so its tags stay unverified.
    const destination = await renameProcessedFile(
        { source, status: "SKIPPED", tags: withCover },
        run
    );
    run.onTrackProcessed?.({ source, status: "TAGGED", destination });
}

function getCurrentPath({ source, destination }: BatchTrack): string {
    return destination ?? source;
}

async function shareFolderCover(
    track: TaggedTrack,
    sharing: CoverSharing,
    run: ActiveBatch
): Promise<void> {
    const { tags } = track;
    if (
        await borrowFolderCover({ path: getCurrentPath(track), tags }, sharing)
    ) {
        await markTaggedByCover(track, tags, run);
    }
}

function getKnownTags(tracks: TaggedTrack[]): Map<string, StoredTags> {
    return new Map(tracks.map((track) => [getCurrentPath(track), track.tags]));
}

function logCoverSharingStart(candidates: BatchTrack[], logger: Logger) {
    if (candidates.length > 0) {
        logger.info("\nSharing covers between tracks of the same album...");
    }
}

async function shareFolderCovers(run: ActiveBatch): Promise<void> {
    const { sourceRoot, logger } = run.context;
    const candidates = run.processed.filter(hasTags);
    const folderCovers = new FolderCovers(getKnownTags(candidates));
    const sharing = { folderCovers, sourceRoot, logger };
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
