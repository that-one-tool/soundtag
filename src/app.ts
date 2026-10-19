import * as fs from "node:fs/promises";
import * as path from "node:path";
import { countStatuses, createReport, processBatch } from "./batch.js";
import { loadConfig, type ConfigSources } from "./config.js";
import { createMetadataChain } from "./create-metadata-chain.js";
import { getErrorMessage, InputCancelledError } from "./errors.js";
import { EXIT_FAILURE, EXIT_INTERRUPTED, EXIT_SUCCESS } from "./exit-codes.js";
import { findAudioFiles } from "./file.js";
import type { AppConfig, ProcessingReport, ProcessingStats } from "./types.js";

const MAX_FILES_PER_RUN = 3000;
const REPORT_FILENAME = "soundtag_output.json";
const SEPARATOR = "========================================";

export interface AppEnvironment extends ConfigSources {
    stopSignal: AbortSignal;
}

interface TaggingRun {
    reportPath: string;
    report: ProcessingReport;
    stopSignal: AbortSignal;
}

function printBanner(): void {
    console.log(SEPARATOR);
    console.log("                SOUNDTAG");
    console.log(`${SEPARATOR}\n`);
    console.log(
        "Usage: npm start -- <source-folder> [--recursive | --no-recursive] [-v | --verbose]"
    );
}

function printRunSettings({ sourceRoot, recursive }: AppConfig): void {
    console.log(`\nSource: ${sourceRoot}`);
    console.log("Tagged files will be updated in place.\n");
    console.log(`Subfolders: ${recursive ? "included" : "excluded"}`);
    console.log(`Batch limit: ${MAX_FILES_PER_RUN} audio files per run\n`);
}

function printSummary(stats: ProcessingStats, run: TaggingRun): void {
    console.log(`\n${SEPARATOR}`);
    console.log(
        run.stopSignal.aborted ? "PROCESSING STOPPED" : "PROCESSING COMPLETE"
    );
    console.log(`Successful: ${stats.ok}`);
    console.log(`Skipped:    ${stats.skipped}`);
    console.log(`Errors:     ${stats.errors}`);
    console.log(`Report:     ${run.reportPath}`);
    console.log(SEPARATOR);
}

function findLibraryFiles({
    sourceRoot,
    recursive,
}: AppConfig): Promise<string[]> {
    return findAudioFiles(sourceRoot, recursive, MAX_FILES_PER_RUN);
}

async function tagLibrary(config: AppConfig, run: TaggingRun): Promise<void> {
    const metadataChain = createMetadataChain(config);
    printRunSettings(config);
    const audioFiles = await findLibraryFiles(config);

    if (audioFiles.length === 0) {
        console.log("No supported audio files found in the source folder.");
        return;
    }

    console.log(
        `Processing ${audioFiles.length} audio files. Starting tagging...\n`
    );
    run.report = createReport(audioFiles, config.sourceRoot);
    await processBatch(audioFiles, {
        context: { sourceRoot: config.sourceRoot, metadataChain },
        report: run.report,
        stopSignal: run.stopSignal,
    });
    printSummary(countStatuses(run.report), run);
}

function getCompletionExitCode({ stopSignal }: TaggingRun): number {
    return stopSignal.aborted ? EXIT_INTERRUPTED : EXIT_SUCCESS;
}

function getFailureExitCode(
    error: unknown,
    { stopSignal }: TaggingRun
): number {
    if (error instanceof InputCancelledError && stopSignal.aborted) {
        return EXIT_INTERRUPTED;
    }

    console.error(`Error: ${getErrorMessage(error)}`);
    return EXIT_FAILURE;
}

async function runTagging(
    sources: ConfigSources,
    run: TaggingRun
): Promise<number> {
    try {
        const config = await loadConfig(sources);
        run.reportPath = path.join(config.sourceRoot, REPORT_FILENAME);
        await tagLibrary(config, run);
        return getCompletionExitCode(run);
    } catch (error) {
        return getFailureExitCode(error, run);
    }
}

async function writeReport({
    reportPath,
    report,
}: TaggingRun): Promise<number> {
    try {
        await fs.writeFile(
            reportPath,
            `${JSON.stringify(report, null, 2)}\n`,
            "utf8"
        );
        console.log(`Processing report written to ${reportPath}`);
        return EXIT_SUCCESS;
    } catch (error) {
        console.error(
            `Could not write processing report to ${reportPath}: ${getErrorMessage(error)}`
        );
        return EXIT_FAILURE;
    }
}

export async function runApp(environment: AppEnvironment): Promise<number> {
    printBanner();
    const run: TaggingRun = {
        reportPath: path.resolve(environment.workingDirectory, REPORT_FILENAME),
        report: { files: {} },
        stopSignal: environment.stopSignal,
    };
    const taggingExitCode = await runTagging(environment, run);
    const reportExitCode = await writeReport(run);
    return Math.max(taggingExitCode, reportExitCode);
}
