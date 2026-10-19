import * as fs from "node:fs/promises";
import * as path from "node:path";
import { countStatuses, createReport, processBatch } from "./batch.js";
import { loadConfig, type ConfigSources } from "./config.js";
import { createMetadataChain } from "./create-metadata-chain.js";
import { getErrorMessage } from "./errors.js";
import { findAudioFiles } from "./file.js";
import type { AppConfig, ProcessingReport, ProcessingStats } from "./types.js";

const MAX_FILES_PER_RUN = 3000;
const REPORT_FILENAME = "soundtag_output.json";
const SEPARATOR = "========================================";

interface RunState {
    reportPath: string;
    report: ProcessingReport;
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

function printSummary(stats: ProcessingStats, reportPath: string): void {
    console.log(`\n${SEPARATOR}`);
    console.log("PROCESSING COMPLETE");
    console.log(`Successful: ${stats.ok}`);
    console.log(`Skipped:    ${stats.skipped}`);
    console.log(`Errors:     ${stats.errors}`);
    console.log(`Report:     ${reportPath}`);
    console.log(SEPARATOR);
}

function findLibraryFiles({
    sourceRoot,
    recursive,
}: AppConfig): Promise<string[]> {
    return findAudioFiles(sourceRoot, recursive, MAX_FILES_PER_RUN);
}

async function tagLibrary(config: AppConfig, run: RunState): Promise<void> {
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
    const context = { sourceRoot: config.sourceRoot, metadataChain };
    await processBatch(audioFiles, context, run.report);
    printSummary(countStatuses(run.report), run.reportPath);
}

async function runTagging(
    sources: ConfigSources,
    run: RunState
): Promise<number> {
    try {
        const config = await loadConfig(sources);
        run.reportPath = path.join(config.sourceRoot, REPORT_FILENAME);
        await tagLibrary(config, run);
        return 0;
    } catch (error) {
        console.error(`Error: ${getErrorMessage(error)}`);
        return 1;
    }
}

async function writeReport({ reportPath, report }: RunState): Promise<number> {
    try {
        await fs.writeFile(
            reportPath,
            `${JSON.stringify(report, null, 2)}\n`,
            "utf8"
        );
        console.log(`Processing report written to ${reportPath}`);
        return 0;
    } catch (error) {
        console.error(
            `Could not write processing report to ${reportPath}: ${getErrorMessage(error)}`
        );
        return 1;
    }
}

export async function runApp(sources: ConfigSources): Promise<number> {
    printBanner();
    const run: RunState = {
        reportPath: path.resolve(sources.workingDirectory, REPORT_FILENAME),
        report: { files: {} },
    };
    const taggingExitCode = await runTagging(sources, run);
    const reportExitCode = await writeReport(run);
    return Math.max(taggingExitCode, reportExitCode);
}
