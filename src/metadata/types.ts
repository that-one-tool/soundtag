import type { BatchCache } from "../shared/batch-cache.js";
import type { ImageRequest } from "../shared/http.js";
import type { ImageCache } from "../shared/image-cache.js";
import type { Logger } from "../shared/logger.js";
import type { LookupLog } from "../shared/lookup-log.js";
import type { Clock } from "../shared/rate-limiter.js";

export interface TrackInfo {
    title: string;
    artist: string;
    album: string;
    year: string;
}

export interface TrackExtras {
    genre?: string;
    albumArtist?: string;
    trackNumber?: number;
    trackCount?: number;
    discNumber?: number;
    discCount?: number;
}

export interface TrackMetadata {
    info: TrackInfo;
    extras: TrackExtras;
    coverData: Buffer | null;
}

export interface ExistingTags {
    info: TrackInfo;
    extras: TrackExtras;
    hasCover: boolean;
}

export interface TrackSearch {
    title: string;
    artist: string;
    album: string;
}

export interface AlbumSearch {
    artist: string;
    album: string;
}

// Like tags, the track count is per disc.
export interface AlbumTrackEntry {
    title: string;
    artist?: string;
    trackNumber: number;
    trackCount: number;
    discNumber: number;
    discCount: number;
}

// The album as the service spells it, with what else the service knows.
export interface FoundAlbum {
    album: string;
    artist: string;
    year?: string;
    genre?: string;
    covers: ImageRequest[];
    tracks?: AlbumTrackEntry[];
}

// What every track of an album shares; found is false when only the folder named it.
export interface AlbumData {
    album: string;
    artist: string;
    year: string;
    genre: string;
    cover: Buffer | null;
    tracks: AlbumTrackEntry[];
    found: boolean;
}

export interface AlbumFinder {
    resolve(search: AlbumSearch, fileCount?: number): Promise<AlbumData>;
}

export interface AlbumSource {
    readonly name: string;
    findAlbum(search: AlbumSearch): Promise<FoundAlbum | null>;
}

// details: the year or an extra is still missing.
export interface ProviderNeeds {
    cover: boolean;
    details: boolean;
}

export interface MetadataProvider {
    readonly name: string;
    findMetadata(
        search: TrackSearch,
        needs: ProviderNeeds
    ): Promise<TrackMetadata | null>;
}

export interface CoverProvider {
    readonly name: string;
    findCover(search: TrackSearch): Promise<Buffer | null>;
}

export interface ProviderServices {
    clock: Clock;
    logger: Logger;
    images: ImageCache;
    cache: BatchCache;
    lookups: LookupLog;
}
