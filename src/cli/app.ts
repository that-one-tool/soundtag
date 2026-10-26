import {
    countStatuses,
    createReport,
    MAX_FILES_PER_RUN,
    processBatch,
    type BatchRun,
} from "../processing/batch.js";
import { parseArguments } from "./cli-options.js";
import {
    loadSessionConfig,
    resolveSourceRoot,
    type ConfigSources,
} from "./config.js";
import {
    createMetadataLookups,
    type MetadataLookups,
} from "../metadata/create-metadata-chain.js";
import { getErrorMessage } from "../shared/errors.js";
import type { TuiOutcome } from "../tui/types.js";
import type { BrowserLauncher } from "./browser-launcher.js";
import { EXIT_FAILURE, EXIT_INTERRUPTED, EXIT_SUCCESS } from "./exit-codes.js";
import { findAudioFiles } from "../library/file.js";
import { consoleLogger } from "../shared/logger.js";
import { systemClock } from "../shared/rate-limiter.js";
import type { ProcessingReport, ProcessingStats } from "../processing/types.js";
import type { AppConfig, SessionConfig, TaggingSettings } from "./types.js";

const SEPARATOR = "========================================";

export interface AppEnvironment extends ConfigSources {
    renewStopSignal: () => AbortSignal;
    canBrowse: boolean;
    openBrowser: BrowserLauncher;
}

interface TaggingRun {
    report: ProcessingReport;
    stopSignal: AbortSignal;
}

interface TaggingSession {
    settings: TaggingSettings;
    lookups: MetadataLookups;
}

type SourceRootResolver = () => Promise<string>;

const NO_TERMINAL_MESSAGE =
    "Browsing folders needs an interactive terminal; pass a source folder instead.";

const BROWSER_EXIT_CODES: Record<TuiOutcome, number> = {
    success: EXIT_SUCCESS,
    failure: EXIT_FAILURE,
    forced: EXIT_INTERRUPTED,
};

function printBanner(): void {
    console.log(SEPARATOR);
    console.log("                SOUNDTAG");
    console.log(`${SEPARATOR}\n`);
    console.log(
        "Usage: soundtag [source-folder] [--recursive | --no-recursive] [-v | --verbose]"
    );
}

function printRunSettings({ sourceRoot, recursive }: AppConfig): void {
    console.log(`\nSource: ${sourceRoot}`);
    console.log("Tagged files will be updated in place.\n");
    console.log(`Subfolders: ${recursive ? "included" : "excluded"}`);
    console.log(`Batch limit: ${MAX_FILES_PER_RUN} audio files per run\n`);
}

function printSummary(stats: ProcessingStats, run: TaggingRun): void {
    const stopped = run.stopSignal.aborted;
    console.log(`\n${SEPARATOR}`);
    console.log(stopped ? "PROCESSING STOPPED" : "PROCESSING COMPLETE");
    console.log(`Successful: ${stats.ok}`);
    console.log(`Skipped:    ${stats.skipped}`);
    console.log(`Errors:     ${stats.errors}`);
    printUnprocessedCount(stats, stopped);
    printSection("Failed:", getFailedFiles(run.report));
    console.log(SEPARATOR);
}

function printUnprocessedCount(stats: ProcessingStats, stopped: boolean): void {
    if (stopped) {
        console.log(`Not processed: ${stats.unprocessed}`);
    }
}

function getFailedFiles({ files }: ProcessingReport): string[] {
    return Object.keys(files).filter((file) => files[file] === "FAILED");
}

function printSection(title: string, lines: string[]): void {
    if (lines.length === 0) {
        return;
    }

    console.log(title);
    lines.forEach((line) => console.log(`  ${line}`));
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

function createBatchRun(
    config: AppConfig,
    run: TaggingRun,
    { chain }: MetadataLookups
): BatchRun {
    return {
        context: {
            sourceRoot: config.sourceRoot,
            metadataChain: chain,
            logger: consoleLogger,
        },
        report: run.report,
        stopSignal: run.stopSignal,
    };
}

async function tagLibrary(
    config: AppConfig,
    stopSignal: AbortSignal,
    lookups: MetadataLookups
): Promise<void> {
    printRunSettings(config);
    const audioFiles = await findLibraryFiles(config);

    if (audioFiles.length === 0) {
        console.log("No supported audio files found in the source folder.");
        return;
    }

    printProcessingStart(audioFiles.length);
    const run = {
        report: createReport(audioFiles, config.sourceRoot),
        stopSignal,
    };
    await processBatch(audioFiles, createBatchRun(config, run, lookups));
    printSummary(countStatuses(run.report), run);
}

function getCompletionExitCode(stopSignal: AbortSignal): number {
    return stopSignal.aborted ? EXIT_INTERRUPTED : EXIT_SUCCESS;
}

// Through the logger, so a progress line on screen is cleared first.
function reportFailure(error: unknown): number {
    consoleLogger.error(`Error: ${getErrorMessage(error)}`);
    return EXIT_FAILURE;
}

async function runTagging(
    session: TaggingSession,
    stopSignal: AbortSignal,
    resolveSource: SourceRootResolver
): Promise<number> {
    try {
        const sourceRoot = await resolveSource();
        const config = { ...session.settings, sourceRoot };
        await tagLibrary(config, stopSignal, session.lookups);
        return getCompletionExitCode(stopSignal);
    } catch (error) {
        return reportFailure(error);
    }
}

async function tagAndFinish(
    session: TaggingSession,
    stopSignal: AbortSignal,
    resolveSource: SourceRootResolver
): Promise<number> {
    const exitCode = await runTagging(session, stopSignal, resolveSource);
    consoleLogger.info("Done!");
    return exitCode;
}

async function browseLibrary(
    settings: TaggingSettings,
    { openBrowser, workingDirectory }: AppEnvironment
): Promise<number> {
    const outcome = await openBrowser({
        ...settings,
        startDirectory: workingDirectory,
    });
    return BROWSER_EXIT_CODES[outcome] ?? EXIT_FAILURE;
}

// Invalid options count as a source argument so the regular run reports them.
function hasSourceArgument(argv: string[]): boolean {
    try {
        return parseArguments(argv).sourcePath !== undefined;
    } catch {
        return true;
    }
}

function isBrowsingWithoutTerminal(environment: AppEnvironment): boolean {
    return !environment.canBrowse && !hasSourceArgument(environment.argv);
}

function createSession(settings: TaggingSettings): TaggingSession {
    return {
        settings,
        lookups: createMetadataLookups(settings, systemClock, consoleLogger),
    };
}

function runSession(
    { settings, sourcePath }: SessionConfig,
    environment: AppEnvironment,
    stopSignal: AbortSignal
): Promise<number> {
    if (sourcePath === undefined) {
        return browseLibrary(settings, environment);
    }

    return tagAndFinish(createSession(settings), stopSignal, () =>
        resolveSourceRoot(sourcePath, environment.workingDirectory)
    );
}

export async function runApp(environment: AppEnvironment): Promise<number> {
    printBanner();

    if (isBrowsingWithoutTerminal(environment)) {
        console.error(`Error: ${NO_TERMINAL_MESSAGE}`);
        return EXIT_FAILURE;
    }

    const stopSignal = environment.renewStopSignal();

    try {
        const sessionConfig = loadSessionConfig(environment);
        return await runSession(sessionConfig, environment, stopSignal);
    } catch (error) {
        return reportFailure(error);
    }
}
