import {
    createMetadataLookups,
    type MetadataChainConfig,
} from "../metadata/create-metadata-chain.js";
import { systemClock } from "../shared/rate-limiter.js";
import type { CoverMode } from "./cover-mode.js";
import { CoverOverlay, type CoverPlacer } from "./cover-overlay.js";
import { createCoverCache } from "./cover-reader.js";
import { createDetailsCache } from "./entry-details.js";
import { EntryRenamer } from "./entry-renamer.js";
import { LogBuffer } from "./log-buffer.js";
import { PathMoves } from "./path-moves.js";
import { RedoneFiles } from "./redone-files.js";
import { createTagJobRunner } from "./tag-job.js";
import { TagClearer } from "./tag-clearer.js";
import { TaggingQueue } from "./tagging-queue.js";
import { ToggleSetting } from "./toggle-setting.js";
import { TrackStatusStore } from "./track-status-store.js";
import type { CoverLookup, EntryDetails, TagJobRunner } from "./types.js";
import type { VersionedCache } from "./versioned-cache.js";

export interface TaggingOptions extends MetadataChainConfig {
    coverMode?: CoverMode;
    recursive: boolean;
    renameFiles: boolean;
    fixTags: boolean;
    startDirectory: string;
}

export interface TuiServices {
    queue: TaggingQueue;
    logBuffer: LogBuffer;
    statusStore: TrackStatusStore;
    redoneFiles: RedoneFiles;
    pathMoves: PathMoves;
    subfolders: ToggleSetting;
    renaming: ToggleSetting;
    fixing: ToggleSetting;
    detailsCache: VersionedCache<EntryDetails>;
    coverCache: VersionedCache<CoverLookup>;
    renamer: EntryRenamer;
    tagClearer: TagClearer;
    coverOverlay: CoverPlacer;
}

export interface CoverDisplay {
    mode: CoverMode;
    writeToTerminal: (text: string) => void;
}

const NO_COVER_DISPLAY: CoverDisplay = {
    mode: "none",
    writeToTerminal: () => {},
};

function clearRedoneFilesAfterJob(
    runJob: TagJobRunner,
    redoneFiles: RedoneFiles
): TagJobRunner {
    return async (target, stopSignal) => {
        try {
            return await runJob(target, stopSignal);
        } finally {
            redoneFiles.clear();
        }
    };
}

function createJobRunner(
    options: TaggingOptions,
    logBuffer: LogBuffer,
    services: Pick<TuiServices, "statusStore" | "redoneFiles" | "pathMoves">
) {
    const { statusStore, redoneFiles, pathMoves } = services;
    const lookups = createMetadataLookups(options, systemClock, logBuffer);
    const runJob = createTagJobRunner({
        metadataChain: lookups.chain,
        corrector: lookups.corrector,
        logger: logBuffer,
        libraryRoot: options.startDirectory,
        onTrackProcessed: (result) => {
            statusStore.record(result);
            redoneFiles.add(result.destination ?? result.source);
        },
        onFolderRenamed: (move) => pathMoves.record(move),
    });
    return clearRedoneFilesAfterJob(runJob, redoneFiles);
}

type JobServices = Pick<
    TuiServices,
    "queue" | "logBuffer" | "statusStore" | "redoneFiles" | "pathMoves"
>;

function createJobServices(options: TaggingOptions): JobServices {
    const logBuffer = new LogBuffer();
    const statusStore = new TrackStatusStore();
    const redoneFiles = new RedoneFiles();
    const pathMoves = new PathMoves();
    const statusServices = { statusStore, redoneFiles, pathMoves };
    const queue = new TaggingQueue(
        createJobRunner(options, logBuffer, statusServices),
        logBuffer
    );
    pathMoves.subscribe((move) => queue.moveTargets(move));
    pathMoves.subscribe((move) => statusStore.recordMove(move));
    pathMoves.subscribe((move) => redoneFiles.recordMove(move));
    return { queue, logBuffer, ...statusServices };
}

function createRenamer({ queue, pathMoves, logBuffer }: JobServices) {
    return new EntryRenamer({ queue, pathMoves, logger: logBuffer });
}

function createTagClearer({ queue, logBuffer, statusStore }: JobServices) {
    return new TagClearer({ queue, logger: logBuffer, statusStore });
}

export function createTuiServices(
    options: TaggingOptions,
    display: CoverDisplay = NO_COVER_DISPLAY
): TuiServices {
    const jobServices = createJobServices(options);
    return {
        ...jobServices,
        renamer: createRenamer(jobServices),
        tagClearer: createTagClearer(jobServices),
        subfolders: new ToggleSetting(options.recursive),
        renaming: new ToggleSetting(options.renameFiles),
        fixing: new ToggleSetting(options.fixTags),
        detailsCache: createDetailsCache(),
        coverCache: createCoverCache(display.mode),
        coverOverlay: new CoverOverlay(display.writeToTerminal),
    };
}
