import type { BatchCache } from "../shared/batch-cache.js";
import type { ImageCache } from "../shared/image-cache.js";
import type { Logger } from "../shared/logger.js";
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
}
