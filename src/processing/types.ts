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
