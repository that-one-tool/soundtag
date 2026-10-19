import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
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

let lastItunesRequestAt = 0;
let itunesRequestQueue: Promise<void> = Promise.resolve();

async function requestItunesSearch(
    title: string,
    artist: string,
    album: string
): Promise<ItunesTrack | null> {
    const url = new URL(ITUNES_SEARCH_URL);
    url.searchParams.set(
        "term",
        [artist, title, album].filter(Boolean).join(" ")
    );
    url.searchParams.set("country", "US");
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "1");

    const request = itunesRequestQueue.then(async () => {
        const timeSinceLastRequest = performance.now() - lastItunesRequestAt;

        if (timeSinceLastRequest < ITUNES_REQUEST_INTERVAL) {
            await delay(ITUNES_REQUEST_INTERVAL - timeSinceLastRequest);
        }

        lastItunesRequestAt = performance.now();
        const responsePromise = fetch(url, {
            signal: AbortSignal.timeout(10_000),
        });
        const response = await responsePromise;

        if (!response.ok) {
            throw new Error(
                `iTunes Search request failed: HTTP ${response.status}`
            );
        }

        const data = (await response.json()) as ItunesSearchResponse;
        return data.results?.[0] ?? null;
    });

    itunesRequestQueue = request.then(
        () => undefined,
        () => undefined
    );

    try {
        return await request;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`iTunes Search failed: ${message}`);
        return null;
    }
}

async function downloadArtwork(
    url: string | undefined
): Promise<Buffer | null> {
    if (!url) {
        return null;
    }

    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            return null;
        }

        const contentType = response.headers.get("content-type") ?? "";

        if (!contentType.toLowerCase().startsWith("image/")) {
            return null;
        }

        const data = Buffer.from(await response.arrayBuffer());
        return data.length > 0 ? data : null;
    } catch {
        return null;
    }
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
