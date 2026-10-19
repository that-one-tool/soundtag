import {
    createMetadataChain,
    type MetadataChainConfig,
} from "../metadata/create-metadata-chain.js";
import { systemClock } from "../shared/rate-limiter.js";
import { LogBuffer } from "./log-buffer.js";
import { SubfolderSetting } from "./subfolder-setting.js";
import { createTagJobRunner } from "./tag-job.js";
import { TaggingQueue } from "./tagging-queue.js";
import { TrackStatusStore } from "./track-status-store.js";

export interface TaggingOptions extends MetadataChainConfig {
    recursive: boolean;
    renameFiles: boolean;
}

export interface TuiServices {
    queue: TaggingQueue;
    logBuffer: LogBuffer;
    statusStore: TrackStatusStore;
    subfolders: SubfolderSetting;
}

export function createTuiServices(options: TaggingOptions): TuiServices {
    const logBuffer = new LogBuffer();
    const statusStore = new TrackStatusStore();
    const runJob = createTagJobRunner({
        metadataChain: createMetadataChain(options, systemClock, logBuffer),
        logger: logBuffer,
        renameFiles: options.renameFiles,
        onTrackProcessed: (result) => statusStore.record(result),
    });
    return {
        queue: new TaggingQueue(runJob, logBuffer),
        logBuffer,
        statusStore,
        subfolders: new SubfolderSetting(options.recursive),
    };
}
