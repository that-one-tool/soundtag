import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
    countStatuses,
    createReport,
    processBatch,
    type BatchRun,
} from "../processing/batch.js";
import {
    loadSessionConfig,
    resolveSourceRoot,
    type ConfigSources,
} from "./config.js";
import { browseFolder } from "./folder-browser.js";
import { createMetadataChain } from "../metadata/create-metadata-chain.js";
import type { MetadataChain } from "../metadata/metadata-chain.js";
import { getErrorMessage, InputCancelledError } from "../shared/errors.js";
import { EXIT_FAILURE, EXIT_INTERRUPTED, EXIT_SUCCESS } from "./exit-codes.js";
import { findAudioFiles } from "../library/file.js";
import type { ProcessingReport, ProcessingStats } from "../processing/types.js";
import type { AppConfig, TaggingSettings } from "./types.js";

const MAX_FILES_PER_RUN = 3000;
const REPORT_FILENAME = "soundtag_output.json";
const SEPARATOR = "========================================";

export interface AppEnvironment extends ConfigSources {
    renewStopSignal: () => AbortSignal;
}

interface TaggingRun {
    reportPath: string;
    report: ProcessingReport;
    stopSignal: AbortSignal;
    interruptedExitCode: number;
}

interface TaggingSession {
    settings: TaggingSettings;
    metadataChain: MetadataChain;
    environment: AppEnvironment;
}

type SourceRootResolver = () => Promise<string>;

type FolderPick = { sourceRoot: string } | { exitCode: number };

function printBanner(): void {
    console.log(SEPARATOR);
    console.log("                SOUNDTAG");
    console.log(`${SEPARATOR}\n`);
    console.log(
        "Usage: npm start -- [source-folder] [--recursive | --no-recursive] [-v | --verbose] [--no-rename]"
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

function printProcessingStart(fileCount: number): void {
    console.log(`Processing ${fileCount} audio files. Starting tagging...\n`);
}

function createRun(
    reportPath: string,
    stopSignal: AbortSignal,
    interruptedExitCode: number
): TaggingRun {
    return {
        reportPath,
        report: { files: {} },
        stopSignal,
        interruptedExitCode,
    };
}

function createBatchRun(
    config: AppConfig,
    run: TaggingRun,
    metadataChain: MetadataChain
): BatchRun {
    return {
        context: { sourceRoot: config.sourceRoot, metadataChain },
        report: run.report,
        stopSignal: run.stopSignal,
        renameFiles: config.renameFiles,
    };
}

async function tagLibrary(
    config: AppConfig,
    run: TaggingRun,
    metadataChain: MetadataChain
): Promise<void> {
    printRunSettings(config);
    const audioFiles = await findLibraryFiles(config);

    if (audioFiles.length === 0) {
        console.log("No supported audio files found in the source folder.");
        return;
    }

    printProcessingStart(audioFiles.length);
    run.report = createReport(audioFiles, config.sourceRoot);
    await processBatch(audioFiles, createBatchRun(config, run, metadataChain));
    printSummary(countStatuses(run.report), run);
}

function getCompletionExitCode(run: TaggingRun): number {
    return run.stopSignal.aborted ? run.interruptedExitCode : EXIT_SUCCESS;
}

function getFailureExitCode(
    error: unknown,
    { stopSignal }: Pick<TaggingRun, "stopSignal">
): number {
    if (error instanceof InputCancelledError && stopSignal.aborted) {
        return EXIT_INTERRUPTED;
    }

    console.error(`Error: ${getErrorMessage(error)}`);
    return EXIT_FAILURE;
}

async function runTagging(
    session: TaggingSession,
    run: TaggingRun,
    resolveSource: SourceRootResolver
): Promise<number> {
    try {
        const sourceRoot = await resolveSource();
        run.reportPath = path.join(sourceRoot, REPORT_FILENAME);
        const config = { ...session.settings, sourceRoot };
        await tagLibrary(config, run, session.metadataChain);
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

async function tagAndReport(
    session: TaggingSession,
    run: TaggingRun,
    resolveSource: SourceRootResolver
): Promise<number> {
    const taggingExitCode = await runTagging(session, run, resolveSource);
    const reportExitCode = await writeReport(run);
    return Math.max(taggingExitCode, reportExitCode);
}

function getBrowserExitCode(error: unknown, stopSignal: AbortSignal): number {
    if (error instanceof InputCancelledError && !stopSignal.aborted) {
        return EXIT_SUCCESS;
    }

    return getFailureExitCode(error, { stopSignal });
}

async function pickSourceFolder(
    { environment }: TaggingSession,
    directory: string,
    stopSignal: AbortSignal
): Promise<FolderPick> {
    try {
        const sourceRoot = await browseFolder(environment.ask, directory);
        return sourceRoot ? { sourceRoot } : { exitCode: EXIT_SUCCESS };
    } catch (error) {
        return { exitCode: getBrowserExitCode(error, stopSignal) };
    }
}

function tagFolder(
    session: TaggingSession,
    sourceRoot: string,
    stopSignal: AbortSignal
): Promise<number> {
    const reportPath = path.join(sourceRoot, REPORT_FILENAME);
    // Ctrl+C during a browsed run only returns to the browser.
    const run = createRun(reportPath, stopSignal, EXIT_SUCCESS);
    return tagAndReport(session, run, async () => sourceRoot);
}

async function browseAndTag(session: TaggingSession): Promise<number> {
    let directory = session.environment.workingDirectory;
    let worstExitCode = EXIT_SUCCESS;

    for (;;) {
        const stopSignal = session.environment.renewStopSignal();
        const pick = await pickSourceFolder(session, directory, stopSignal);

        if ("exitCode" in pick) {
            return Math.max(worstExitCode, pick.exitCode);
        }

        const exitCode = await tagFolder(session, pick.sourceRoot, stopSignal);
        worstExitCode = Math.max(worstExitCode, exitCode);
        directory = pick.sourceRoot;
    }
}

function runSession(
    session: TaggingSession,
    sourcePath: string | undefined,
    setupRun: TaggingRun
): Promise<number> {
    const { workingDirectory } = session.environment;

    if (sourcePath === undefined) {
        return browseAndTag(session);
    }

    return tagAndReport(session, setupRun, () =>
        resolveSourceRoot(sourcePath, workingDirectory)
    );
}

function createSession(
    settings: TaggingSettings,
    environment: AppEnvironment
): TaggingSession {
    return {
        settings,
        metadataChain: createMetadataChain(settings),
        environment,
    };
}

export async function runApp(environment: AppEnvironment): Promise<number> {
    printBanner();
    const setupRun = createRun(
        path.resolve(environment.workingDirectory, REPORT_FILENAME),
        environment.renewStopSignal(),
        EXIT_INTERRUPTED
    );

    try {
        const { settings, sourcePath } = await loadSessionConfig(environment);
        return await runSession(
            createSession(settings, environment),
            sourcePath,
            setupRun
        );
    } catch (error) {
        const setupExitCode = getFailureExitCode(error, setupRun);
        return Math.max(setupExitCode, await writeReport(setupRun));
    }
}
