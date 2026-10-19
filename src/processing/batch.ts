import * as path from "node:path";
import { FolderNameCache } from "../library/folder-names.js";
import { processTrack, type ProcessingContext } from "./processing.js";
import { renameTrack } from "./rename.js";
import type {
    FileStatus,
    ProcessingReport,
    ProcessingStats,
    TrackStatus,
} from "./types.js";

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
    renameFiles: boolean;
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
): Promise<void> {
    if (!run.renameFiles) {
        return;
    }

    const destination = await renameTrack(source, status, run.folderNames);

    if (destination) {
        recordRename(source, destination, run);
    }
}

async function processFile(
    source: string,
    position: string,
    run: ActiveBatch
): Promise<void> {
    const relativePath = path.relative(run.context.sourceRoot, source);
    logTrackHeader(`[${position}] ${relativePath}`, source);
    const status = await processTrack(source, run.context);
    run.report.files[relativePath] = status;
    await renameProcessedFile(source, status, run);
    run.folderNames.markProcessed(source);
}

async function processFiles(files: string[], run: ActiveBatch): Promise<void> {
    for (const [index, source] of files.entries()) {
        if (run.stopSignal.aborted) {
            console.log("Stopped before processing the remaining files.");
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
