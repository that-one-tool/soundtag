import {
    countStatuses,
    createReport,
    MAX_FILES_PER_RUN,
    processBatch,
    type BatchRun,
} from "../processing/batch.js";
import { parseArguments } from "./cli-options.js";
import {
    findSearchRoot,
    loadSessionConfig,
    resolveSources,
    type ConfigSources,
} from "./config.js";
import {
    createMetadataLookups,
    type MetadataLookups,
} from "../metadata/create-metadata-chain.js";
import { getErrorMessage } from "../shared/errors.js";
import type { TuiOutcome } from "../tui/types.js";
import type { BrowserLauncher } from "./browser-launcher.js";
import {
    createJsonEvents,
    isJsonRequested,
    silentEvents,
    type OutputWriter,
    type RunEvents,
} from "./run-events.js";

import { EXIT_FAILURE, EXIT_INTERRUPTED, EXIT_SUCCESS } from "./exit-codes.js";
import { findSourceAudioFiles } from "../library/file.js";
import { consoleLogger } from "../shared/logger.js";
import { systemClock } from "../shared/rate-limiter.js";
import type { ProcessingReport, ProcessingStats } from "../processing/types.js";
import type {
    AppConfig,
    ResolvedSources,
    SessionConfig,
    TaggingSettings,
} from "./types.js";

const SEPARATOR = "========================================";

export interface AppEnvironment extends ConfigSources {
    renewStopSignal: () => AbortSignal;
    canBrowse: boolean;
    openBrowser: BrowserLauncher;
    writeOutput: OutputWriter;
}

interface TaggingRun {
    report: ProcessingReport;
    stopSignal: AbortSignal;
}

interface RunControl {
    stopSignal: AbortSignal;
    events: RunEvents;
}

interface TaggingSession {
    settings: TaggingSettings;
    lookups: MetadataLookups;
    events: RunEvents;
}

type SourcesResolver = () => Promise<ResolvedSources>;

const NO_TERMINAL_MESSAGE =
    "Browsing folders needs an interactive terminal; pass a source folder instead.";
const JSON_NEEDS_SOURCE_MESSAGE = "--json needs a source folder or file.";

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
        "Usage: soundtag [source-folder | audio-file ...] [--recursive | --no-recursive] [-v | --verbose] [--overwrite] [--json]"
    );
}

function printRunSettings(config: AppConfig): void {
    console.log(`\nSource: ${config.sources.root}`);
    console.log("Tagged files will be updated in place.\n");
    console.log(`Subfolders: ${config.recursive ? "included" : "excluded"}`);
    console.log(`Existing tags: ${config.overwrite ? "overwritten" : "kept"}`);
    console.log(`Batch limit: ${MAX_FILES_PER_RUN} audio files per run\n`);
}

function printSummary(
    stats: ProcessingStats,
    run: TaggingRun,
    events: RunEvents
): void {
    const stopped = run.stopSignal.aborted;
    events.summary(stats, { stopped });
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
    sources,
    recursive,
}: AppConfig): Promise<string[]> {
    return findSourceAudioFiles(sources, recursive, MAX_FILES_PER_RUN);
}

function printProcessingStart(fileCount: number): void {
    console.log(`Processing ${fileCount} audio files. Starting tagging...\n`);
}

function createBatchRun(
    config: AppConfig,
    run: TaggingRun,
    { lookups: { chain, albums }, events }: TaggingSession
): BatchRun {
    return {
        context: {
            sourceRoot: config.sources.root,
            findSearchRoot: (file) => findSearchRoot(config.sources, file),
            metadataChain: chain,
            logger: consoleLogger,
            overwrite: config.overwrite,
        },
        albums,
        report: run.report,
        stopSignal: run.stopSignal,
        onPlanned: (total) => events.start(total),
        onTrackProcessed: (track) => events.file(track),
    };
}

const NO_FILES: ProcessingStats = {
    ok: 0,
    skipped: 0,
    errors: 0,
    unprocessed: 0,
};

function reportNoFiles(events: RunEvents): void {
    console.log("No supported audio files found in the source folder.");
    events.start(0);
    events.summary(NO_FILES, { stopped: false });
}

async function tagLibrary(
    config: AppConfig,
    stopSignal: AbortSignal,
    session: TaggingSession
): Promise<void> {
    printRunSettings(config);
    const audioFiles = await findLibraryFiles(config);

    if (audioFiles.length === 0) {
        return reportNoFiles(session.events);
    }

    printProcessingStart(audioFiles.length);
    const run = {
        report: createReport(audioFiles, config.sources.root),
        stopSignal,
    };
    await processBatch(audioFiles, createBatchRun(config, run, session));
    printSummary(countStatuses(run.report), run, session.events);
}

function getCompletionExitCode(stopSignal: AbortSignal): number {
    return stopSignal.aborted ? EXIT_INTERRUPTED : EXIT_SUCCESS;
}

// Through the logger, so a progress line on screen is cleared first.
function reportFailure(error: unknown, events: RunEvents): number {
    const message = getErrorMessage(error);
    consoleLogger.error(`Error: ${message}`);
    events.error(message);
    return EXIT_FAILURE;
}

async function runTagging(
    session: TaggingSession,
    stopSignal: AbortSignal,
    resolveSource: SourcesResolver
): Promise<number> {
    try {
        const sources = await resolveSource();
        const config = { ...session.settings, sources };
        await tagLibrary(config, stopSignal, session);
        return getCompletionExitCode(stopSignal);
    } catch (error) {
        return reportFailure(error, session.events);
    }
}

async function tagAndFinish(
    session: TaggingSession,
    stopSignal: AbortSignal,
    resolveSource: SourcesResolver
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
        return parseArguments(argv).sourcePaths.length > 0;
    } catch {
        return true;
    }
}

function isBrowsingWithoutTerminal(environment: AppEnvironment): boolean {
    return !environment.canBrowse && !hasSourceArgument(environment.argv);
}

function isJsonWithoutSource({ argv }: AppEnvironment): boolean {
    return isJsonRequested(argv) && !hasSourceArgument(argv);
}

function findStartError(environment: AppEnvironment): string | null {
    if (isJsonWithoutSource(environment)) {
        return JSON_NEEDS_SOURCE_MESSAGE;
    }

    return isBrowsingWithoutTerminal(environment) ? NO_TERMINAL_MESSAGE : null;
}

function createRunEvents({ argv, writeOutput }: AppEnvironment): RunEvents {
    return isJsonRequested(argv) ? createJsonEvents(writeOutput) : silentEvents;
}

function createSession(
    settings: TaggingSettings,
    events: RunEvents
): TaggingSession {
    return {
        settings,
        lookups: createMetadataLookups(settings, systemClock, consoleLogger),
        events,
    };
}

function runSession(
    { settings, sourcePaths }: SessionConfig,
    environment: AppEnvironment,
    { stopSignal, events }: RunControl
): Promise<number> {
    if (sourcePaths.length === 0) {
        return browseLibrary(settings, environment);
    }

    return tagAndFinish(createSession(settings, events), stopSignal, () =>
        resolveSources(sourcePaths, environment.workingDirectory)
    );
}

export async function runApp(environment: AppEnvironment): Promise<number> {
    printBanner();
    const events = createRunEvents(environment);
    const startError = findStartError(environment);

    if (startError) {
        return reportFailure(new Error(startError), events);
    }

    const control = { stopSignal: environment.renewStopSignal(), events };

    try {
        const sessionConfig = loadSessionConfig(environment);
        return await runSession(sessionConfig, environment, control);
    } catch (error) {
        return reportFailure(error, events);
    }
}
