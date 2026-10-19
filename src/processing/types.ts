import type { StoredTags } from "../tags/types.js";

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
    renamed?: Record<string, string>;
}

export interface TrackResult {
    status: TrackStatus;
    tags: StoredTags | null;
}

export interface ProcessingTrack extends TrackResult {
    source: string;
}

export interface ProcessedTrack {
    source: string;
    status: TrackStatus;
    destination: string | null;
}
