import * as path from "node:path";
import type { Logger } from "../shared/logger.js";
import { processTrack, type ProcessingContext } from "./processing.js";
import type {
    FileStatus,
    ProcessedTrack,
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
    const format = path.extname(source).slice(1).toUpperCase();
    logger.info(`\n${position} (${format})`);
}

export interface BatchRun {
    context: ProcessingContext;
    report: ProcessingReport;
    stopSignal: AbortSignal;
    onTrackProcessed?: (result: ProcessedTrack) => void;
}

async function processFile(
    source: string,
    position: string,
    run: BatchRun
): Promise<void> {
    const relativePath = path.relative(run.context.sourceRoot, source);
    logTrackHeader(`[${position}] ${relativePath}`, source, run.context.logger);
    const status = await processTrack(source, run.context);
    run.report.files[relativePath] = status;
    run.onTrackProcessed?.({ source, status });
}

async function processFiles(files: string[], run: BatchRun): Promise<void> {
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
    try {
        await processFiles(files, run);
    } finally {
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
