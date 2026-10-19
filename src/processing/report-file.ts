import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import type { FileStatus, ProcessingReport } from "./types.js";

const REPORT_FILENAME = "soundtag_output.json";

export function getReportPath(folder: string): string {
    return path.join(folder, REPORT_FILENAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toReportFields(saved: Record<string, unknown>): ProcessingReport {
    const files = saved.files as ProcessingReport["files"];
    return isRecord(saved.renamed)
        ? { files, renamed: saved.renamed as Record<string, string> }
        : { files };
}

function toReport(saved: unknown): ProcessingReport {
    if (!isRecord(saved) || !isRecord(saved.files)) {
        return { files: {} };
    }

    return toReportFields(saved);
}

export async function readReport(
    reportPath: string
): Promise<ProcessingReport> {
    try {
        return toReport(JSON.parse(await fs.readFile(reportPath, "utf8")));
    } catch {
        return { files: {} };
    }
}

// An unprocessed file must not hide the result of an earlier run.
function mergeFiles(
    existing: Record<string, FileStatus>,
    update: Record<string, FileStatus>
): Record<string, FileStatus> {
    const processed = Object.entries(update).filter(
        ([, status]) => status !== "READ"
    );
    return { ...update, ...existing, ...Object.fromEntries(processed) };
}

export function mergeReports(
    existing: ProcessingReport,
    update: ProcessingReport
): ProcessingReport {
    const files = mergeFiles(existing.files, update.files);
    const renamed = { ...existing.renamed, ...update.renamed };
    return Object.keys(renamed).length > 0 ? { files, renamed } : { files };
}

export async function saveReport(
    reportPath: string,
    report: ProcessingReport,
    logger: Logger
): Promise<boolean> {
    logger.info("\nSaving report...");
    const content = `${JSON.stringify(report, null, 2)}\n`;
    try {
        await fs.writeFile(reportPath, content, "utf8");
        logger.info(`Processing report written to ${reportPath}`);
        return true;
    } catch (error) {
        logger.error(
            `Could not write processing report to ${reportPath}: ${getErrorMessage(error)}`
        );
        return false;
    }
}

function logDeletionFailure(
    reportPath: string,
    error: unknown,
    logger: Logger
): void {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.info(`No report to delete in ${path.dirname(reportPath)}.`);
        return;
    }

    logger.error(`Could not delete ${reportPath}: ${getErrorMessage(error)}`);
}

export async function deleteReport(
    reportPath: string,
    logger: Logger
): Promise<void> {
    try {
        await fs.unlink(reportPath);
        logger.info(`Deleted ${reportPath}`);
    } catch (error) {
        logDeletionFailure(reportPath, error, logger);
    }
}
