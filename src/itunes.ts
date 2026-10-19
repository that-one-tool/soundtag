import { getErrorMessage } from "./errors.js";
import {
    downloadFirstImage,
    fetchWithTimeout,
    readJsonResponse,
} from "./http.js";
import { createRateLimiter } from "./rate-limiter.js";
import type { TrackInfo } from "./types.js";

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const ITUNES_REQUEST_INTERVAL = 3_000;

interface ItunesTrack {
    trackName?: string;
    artistName?: string;
    collectionName?: string;
    releaseDate?: string;
    artworkUrl100?: string;
}

interface ItunesSearchResponse {
    results?: ItunesTrack[];
}

const scheduleItunesRequest = createRateLimiter(ITUNES_REQUEST_INTERVAL);

function buildItunesSearchUrl(
    title: string,
    artist: string,
    album: string
): URL {
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

async function requestItunesSearch(
    title: string,
    artist: string,
    album: string
): Promise<ItunesTrack | null> {
    const url = buildItunesSearchUrl(title, artist, album);

    try {
        const data = await scheduleItunesRequest(async () =>
            readJsonResponse<ItunesSearchResponse>(
                await fetchWithTimeout(url),
                "iTunes Search"
            )
        );
        return getFirstItunesTrack(data);
    } catch (error) {
        console.error(`iTunes Search failed: ${getErrorMessage(error)}`);
        return null;
    }
}

function downloadArtwork(url: string | undefined): Promise<Buffer | null> {
    return url ? downloadFirstImage([{ url }]) : Promise.resolve(null);
}

export async function findItunesMetadata(
    title: string,
    artist: string,
    album = ""
): Promise<{ info: TrackInfo; coverData: Buffer | null } | null> {
    const result = await requestItunesSearch(title, artist, album);

    if (!result) {
        return null;
    }

    return {
        info: {
            title: result.trackName ?? "",
            artist: result.artistName ?? "",
            album: result.collectionName ?? "",
            year: result.releaseDate?.match(/\b\d{4}\b/)?.[0] ?? "",
        },
        coverData: await downloadArtwork(result.artworkUrl100),
    };
}
