export interface ProcessingStats {
    ok: number;
    skipped: number;
    errors: number;
}

export type FileStatus = "READ" | "SKIPPED" | "TAGGED" | "FAILED";

export type TrackStatus = Exclude<FileStatus, "READ">;

export interface ProcessingReport {
    files: Record<string, FileStatus>;
}

export interface AppConfig {
    lastFmApiKey: string;
    sourceRoot: string;
    recursive: boolean;
    verbose: boolean;
    musicBrainzUserAgent?: string;
    youtubeApiKey?: string;
}

export interface CommandLineOptions {
    sourcePath?: string;
    recursive: boolean;
    verbose: boolean;
}

export interface TrackSearchTerms {
    title: string;
    artist?: string;
    album?: string;
}

export type FolderSearchTerms = Pick<TrackSearchTerms, "artist" | "album">;

export interface TrackInfo {
    title: string;
    artist: string;
    album: string;
    year: string;
}

export interface TrackMetadata {
    info: TrackInfo;
    coverData: Buffer | null;
}

export interface TrackSearch {
    title: string;
    artist: string;
    album: string;
}

export interface MetadataProvider {
    findMetadata(
        search: TrackSearch,
        needsCover: boolean
    ): Promise<TrackMetadata | null>;
}

export interface CoverProvider {
    findCover(search: TrackSearch): Promise<Buffer | null>;
}

export interface StoredTags {
    info: TrackInfo;
    hasCover: boolean;
}

export interface TagStore {
    read(source: string): Promise<StoredTags>;
    write(source: string, metadata: TrackMetadata): Promise<void>;
}
