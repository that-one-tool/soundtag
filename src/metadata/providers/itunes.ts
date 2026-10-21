import { getErrorMessage } from "../../shared/errors.js";
import type { ImageCache } from "../../shared/image-cache.js";
import { fetchWithTimeout, readJsonResponse } from "../../shared/http.js";
import {
    createRateLimiter,
    type RateLimiter,
} from "../../shared/rate-limiter.js";
import {
    extractYear,
    optionalCount,
    optionalText,
    removeUnknownValues,
    valueOrEmpty,
} from "../track-metadata.js";
import { isSameRelease, isSameTrack } from "../track-matching.js";
import type {
    MetadataProvider,
    ProviderNeeds,
    ProviderServices,
    TrackExtras,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../types.js";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const ITUNES_REQUEST_INTERVAL = 4_000;

interface ItunesTrack {
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    releaseDate?: string;
    artworkUrl100?: string;
    primaryGenreName?: string;
    collectionArtistName?: string;
    trackNumber?: number;
    trackCount?: number;
    discNumber?: number;
    discCount?: number;
}

interface ItunesSearchResponse {
    results?: ItunesTrack[];
}

function buildItunesSearchUrl({ title, artist, album }: TrackSearch): URL {
    const url = new URL(ITUNES_SEARCH_URL);
    url.searchParams.set(
        "term",
        [artist, title, album].filter(Boolean).join(" ")
    );
    url.searchParams.set("country", "US");
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "1");
    return url;
}

function getFirstItunesTrack(data: ItunesSearchResponse): ItunesTrack | null {
    return data.results?.[0] ?? null;
}

function getItunesTrackInfo(track: ItunesTrack): TrackInfo {
    return {
        title: valueOrEmpty(track.trackName),
        artist: valueOrEmpty(track.artistName),
        album: valueOrEmpty(track.collectionName),
        year: extractYear(track.releaseDate),
    };
}

function getReleaseExtras(track: ItunesTrack): TrackExtras {
    return {
        albumArtist: optionalText(track.collectionArtistName),
        trackNumber: optionalCount(track.trackNumber),
        trackCount: optionalCount(track.trackCount),
        discNumber: optionalCount(track.discNumber),
        discCount: optionalCount(track.discCount),
    };
}

function isSearchedTrack(track: ItunesTrack, search: TrackSearch): boolean {
    const found = { title: track.trackName, artist: track.artistName };
    return isSameTrack(found, search);
}

// Artwork of a karaoke version or a compilation would be wrong.
function isSearchedRelease(track: ItunesTrack, search: TrackSearch): boolean {
    return (
        isSearchedTrack(track, search) &&
        isSameRelease(track.collectionName, search.album)
    );
}

function getMatchedExtras(
    track: ItunesTrack,
    search: TrackSearch
): TrackExtras {
    return isSearchedTrack(track, search)
        ? getItunesExtras(track, search.album)
        : {};
}

function getItunesExtras(track: ItunesTrack, album: string): TrackExtras {
    const releaseExtras = isSameRelease(track.collectionName, album)
        ? getReleaseExtras(track)
        : {};
    return removeUnknownValues({
        genre: optionalText(track.primaryGenreName),
        ...releaseExtras,
    });
}

function downloadArtwork(
    images: ImageCache,
    url: string | undefined
): Promise<Buffer | null> {
    return url ? images.downloadFirst([{ url }]) : Promise.resolve(null);
}

export class ItunesProvider implements MetadataProvider {
    readonly name = "iTunes";
    private readonly schedule: RateLimiter;

    constructor(private readonly services: ProviderServices) {
        this.schedule = createRateLimiter(
            ITUNES_REQUEST_INTERVAL,
            services.clock
        );
    }

    async findMetadata(
        search: TrackSearch,
        { cover: needsCover }: ProviderNeeds
    ): Promise<TrackMetadata | null> {
        const track = await this.searchTrack(search);

        if (!track) {
            return null;
        }

        return {
            info: getItunesTrackInfo(track),
            extras: getMatchedExtras(track, search),
            coverData: await this.findArtwork(track, search, needsCover),
        };
    }

    private findArtwork(
        track: ItunesTrack,
        search: TrackSearch,
        needsCover: boolean
    ): Promise<Buffer | null> {
        return needsCover && isSearchedRelease(track, search)
            ? downloadArtwork(this.services.images, track.artworkUrl100)
            : Promise.resolve(null);
    }

    private async searchTrack(
        search: TrackSearch
    ): Promise<ItunesTrack | null> {
        const url = buildItunesSearchUrl(search);

        try {
            const data = await this.schedule(async () =>
                readJsonResponse<ItunesSearchResponse>(
                    await fetchWithTimeout(url),
                    "iTunes Search"
                )
            );
            return getFirstItunesTrack(data);
        } catch (error) {
            this.services.logger.error(
                `iTunes Search failed: ${getErrorMessage(error)}`
            );
            return null;
        }
    }
}
