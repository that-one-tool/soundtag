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

export async function processBatch(
    files: string[],
    context: ProcessingContext,
    report: ProcessingReport
): Promise<void> {
    for (const [index, source] of files.entries()) {
        const relativePath = path.relative(context.sourceRoot, source);
        logTrackHeader(
            `[${index + 1}/${files.length}] ${relativePath}`,
            source
        );
        report.files[relativePath] = await processTrack(source, context);
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
