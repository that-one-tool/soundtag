import * as path from "node:path";
import { FolderNameCache } from "../library/folder-names.js";
import type { Logger } from "../shared/logger.js";
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

export async function processBatch(
    files: string[],
    run: BatchRun
): Promise<void> {
    const folderNames = new FolderNameCache(files);

    try {
        await processFiles(files, { ...run, folderNames });
    } finally {
        folderNames.clear();
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
    };
}
