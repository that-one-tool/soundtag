import type { TagCorrection } from "../metadata/types.js";
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
    corrected?: Record<string, string[]>;
}

export interface TrackOutcome {
    status: TrackStatus;
    tags: StoredTags | null;
}

export interface TrackResult extends TrackOutcome {
    corrections: TagCorrection[];
}

export interface ProcessingTrack extends TrackOutcome {
    source: string;
}

export interface ProcessedTrack {
    source: string;
    status: TrackStatus;
    destination: string | null;
}

export interface FolderAlbum {
    folder: string;
    artist: string;
    album: string;
    key: string;
    disc: number | null;
    discCount: number;
}

export interface FolderName {
    folder: string;
    name: string;
}
