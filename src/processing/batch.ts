import * as path from "node:path";
import { processTrack, type ProcessingContext } from "./processing.js";
import type { FileStatus, ProcessingReport, ProcessingStats } from "./types.js";

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

function logTrackHeader(position: string, source: string): void {
    console.log(`\n${position}`);
    console.log(`Format: ${path.extname(source).slice(1).toUpperCase()}`);
}

export interface BatchRun {
    context: ProcessingContext;
    report: ProcessingReport;
    stopSignal: AbortSignal;
}

async function processFile(
    source: string,
    position: string,
    { context, report }: BatchRun
): Promise<void> {
    const relativePath = path.relative(context.sourceRoot, source);
    logTrackHeader(`[${position}] ${relativePath}`, source);
    report.files[relativePath] = await processTrack(source, context);
}

export async function processBatch(
    files: string[],
    run: BatchRun
): Promise<void> {
    for (const [index, source] of files.entries()) {
        if (run.stopSignal.aborted) {
            console.log("Stopped before processing the remaining files.");
            return;
        }

        await processFile(source, `${index + 1}/${files.length}`, run);
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
