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
import type {
    MetadataProvider,
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

function normalizeAlbum(album: string | undefined): string {
    return valueOrEmpty(album).trim().toLowerCase();
}

// Track and disc numbers from another release (compilation, single) would be wrong.
function isSameRelease(track: ItunesTrack, album: string): boolean {
    return (
        !album || normalizeAlbum(track.collectionName) === normalizeAlbum(album)
    );
}

// Brackets that name another version (live, karaoke, remix) must still differ.
const NOISE_BRACKET =
    /[([][^)\]]*\b(?:remaster|feat|ft\b|explicit|mono|stereo)[^)\]]*[)\]]/g;

function normalizeName(name: string | undefined): string {
    return valueOrEmpty(name)
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{M}/gu, "")
        .replaceAll(NOISE_BRACKET, "")
        .replaceAll(/[^\p{L}\p{N}]/gu, "");
}

function isSameName(found: string | undefined, searched: string): boolean {
    return normalizeName(found) === normalizeName(searched);
}

// limit=1 can return a karaoke or cover version, whose extras would stick.
function isSameTrack(track: ItunesTrack, { title, artist }: TrackSearch) {
    const isSameArtist = !artist || isSameName(track.artistName, artist);
    return isSameArtist && isSameName(track.trackName, title);
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

function getMatchedExtras(
    track: ItunesTrack,
    search: TrackSearch
): TrackExtras {
    return isSameTrack(track, search)
        ? getItunesExtras(track, search.album)
        : {};
}

function getItunesExtras(track: ItunesTrack, album: string): TrackExtras {
    const releaseExtras = isSameRelease(track, album)
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
        needsCover: boolean
    ): Promise<TrackMetadata | null> {
        const track = await this.searchTrack(search);

        if (!track) {
            return null;
        }

        return {
            info: getItunesTrackInfo(track),
            extras: getMatchedExtras(track, search),
            coverData: needsCover
                ? await downloadArtwork(
                      this.services.images,
                      track.artworkUrl100
                  )
                : null,
        };
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
