import type { MetadataChain } from "../metadata/metadata-chain.js";
import type { Logger } from "../shared/logger.js";

export interface ProcessingStats {
    ok: number;
    skipped: number;
    errors: number;
    unprocessed: number;
}

export type FileStatus = "READ" | "SKIPPED" | "TAGGED" | "FAILED";

export type TrackStatus = Exclude<FileStatus, "READ">;

export interface ProcessingReport {
    files: Record<string, FileStatus>;
}

export interface ProcessedTrack {
    source: string;
    status: TrackStatus;
}

export interface ProcessingContext {
    sourceRoot: string;
    metadataChain: MetadataChain;
    logger: Logger;
    // Found values replace the stored ones instead of only filling the gaps.
    overwrite?: boolean;
}
