import {
    createMetadataChain,
    type MetadataChainConfig,
} from "../metadata/create-metadata-chain.js";
import { systemClock } from "../shared/rate-limiter.js";
import { createCoverCache, type CoverDisplay } from "./cover-reader.js";
import { createDetailsCache } from "./entry-details.js";
import { EntryRenamer } from "./entry-renamer.js";
import { LogBuffer } from "./log-buffer.js";
import { PathMoves } from "./path-moves.js";
import { SubfolderSetting } from "./subfolder-setting.js";
import { createTagJobRunner } from "./tag-job.js";
import { TaggingQueue } from "./tagging-queue.js";
import { TrackStatusStore } from "./track-status-store.js";
import type { CoverLookup, EntryDetails } from "./types.js";
import type { VersionedCache } from "./versioned-cache.js";

export interface TaggingOptions extends MetadataChainConfig {
    recursive: boolean;
    renameFiles: boolean;
    startDirectory: string;
}

export interface TuiServices {
    queue: TaggingQueue;
    logBuffer: LogBuffer;
    statusStore: TrackStatusStore;
    pathMoves: PathMoves;
    subfolders: SubfolderSetting;
    detailsCache: VersionedCache<EntryDetails>;
    coverCache: VersionedCache<CoverLookup>;
    renamer: EntryRenamer;
}

function createJobRunner(
    options: TaggingOptions,
    logBuffer: LogBuffer,
    { statusStore, pathMoves }: Pick<TuiServices, "statusStore" | "pathMoves">
) {
    return createTagJobRunner({
        metadataChain: createMetadataChain(options, systemClock, logBuffer),
        logger: logBuffer,
        renameFiles: options.renameFiles,
        libraryRoot: options.startDirectory,
        onTrackProcessed: (result) => statusStore.record(result),
        onFolderRenamed: (move) => pathMoves.record(move),
    });
}

type JobServices = Pick<
    TuiServices,
    "queue" | "logBuffer" | "statusStore" | "pathMoves"
>;

function createJobServices(options: TaggingOptions): JobServices {
    const logBuffer = new LogBuffer();
    const statusStore = new TrackStatusStore();
    const pathMoves = new PathMoves();
    const queue = new TaggingQueue(
        createJobRunner(options, logBuffer, { statusStore, pathMoves }),
        logBuffer
    );
    pathMoves.subscribe((move) => queue.moveTargets(move));
    pathMoves.subscribe((move) => statusStore.recordMove(move));
    return { queue, logBuffer, statusStore, pathMoves };
}

function createRenamer({ queue, pathMoves, logBuffer }: JobServices) {
    return new EntryRenamer({ queue, pathMoves, logger: logBuffer });
}

export function createTuiServices(
    options: TaggingOptions,
    display: CoverDisplay = { trueColor: false }
): TuiServices {
    const jobServices = createJobServices(options);
    return {
        ...jobServices,
        renamer: createRenamer(jobServices),
        subfolders: new SubfolderSetting(options.recursive),
        detailsCache: createDetailsCache(),
        coverCache: createCoverCache(display),
    };
}
