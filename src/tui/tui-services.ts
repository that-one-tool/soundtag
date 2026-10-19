import {
    createMetadataChain,
    type MetadataChainConfig,
} from "../metadata/create-metadata-chain.js";
import { systemClock } from "../shared/rate-limiter.js";
import { createCoverCache, type CoverDisplay } from "./cover-reader.js";
import { createDetailsCache } from "./entry-details.js";
import { LogBuffer } from "./log-buffer.js";
import { SubfolderSetting } from "./subfolder-setting.js";
import { createTagJobRunner } from "./tag-job.js";
import { TaggingQueue } from "./tagging-queue.js";
import { TrackStatusStore } from "./track-status-store.js";
import type { CoverLookup, EntryDetails } from "./types.js";
import type { VersionedCache } from "./versioned-cache.js";

export interface TaggingOptions extends MetadataChainConfig {
    recursive: boolean;
    renameFiles: boolean;
}

export interface TuiServices {
    queue: TaggingQueue;
    logBuffer: LogBuffer;
    statusStore: TrackStatusStore;
    subfolders: SubfolderSetting;
    detailsCache: VersionedCache<EntryDetails>;
    coverCache: VersionedCache<CoverLookup>;
}

function createJobRunner(
    options: TaggingOptions,
    logBuffer: LogBuffer,
    statusStore: TrackStatusStore
) {
    return createTagJobRunner({
        metadataChain: createMetadataChain(options, systemClock, logBuffer),
        logger: logBuffer,
        renameFiles: options.renameFiles,
        onTrackProcessed: (result) => statusStore.record(result),
    });
}

export function createTuiServices(
    options: TaggingOptions,
    display: CoverDisplay = { trueColor: false }
): TuiServices {
    const logBuffer = new LogBuffer();
    const statusStore = new TrackStatusStore();
    const runJob = createJobRunner(options, logBuffer, statusStore);
    return {
        queue: new TaggingQueue(runJob, logBuffer),
        logBuffer,
        statusStore,
        subfolders: new SubfolderSetting(options.recursive),
        detailsCache: createDetailsCache(),
        coverCache: createCoverCache(display),
    };
}
