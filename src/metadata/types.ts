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

// The album as the service spells it.
export interface FoundAlbum {
    album: string;
    covers: ImageRequest[];
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

// The spelling and first release year a service gives for the searched song.
export interface CanonicalTrack {
    title: string;
    artist: string;
    firstReleaseYear: string;
}

export interface CanonicalSource {
    readonly name: string;
    findCanonical(search: TrackSearch): Promise<CanonicalTrack | null>;
}

export type IdentityField = "title" | "artist";

// Only the fields that look wrong give way, so a good title survives a file name search.
export interface AlternativeSearch {
    kind: string;
    search: TrackSearch;
    replaces: IdentityField[];
}

// Alternatives replace the identity only when a witness confirms them.
export interface CorrectionRequest {
    tagSearch: TrackSearch;
    alternatives: AlternativeSearch[];
    hasSuspectTags: boolean;
}

export interface TagCorrection {
    field: keyof TrackInfo;
    from: string;
    to: string;
}

export interface ProviderServices {
    clock: Clock;
    logger: Logger;
    images: ImageCache;
    cache: BatchCache;
    lookups: LookupLog;
}
