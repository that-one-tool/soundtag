import type { TrackInfo, TrackMetadata } from "./types.js";

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";
const DEFAULT_COVER = "2a96cbd8b46e442fc41c2b86b821562f.png";
const MAX_LARGE_COVER_BYTES = 500 * 1024;

interface LastFmImage {
    size?: string;
    "#text"?: string;
}

interface LastFmAlbum {
    title?: string;
    date?: string;
    year?: string;
    image?: LastFmImage[];
}

interface LastFmTrack {
    name?: string;
    artist?: string | { name?: string };
    album?: LastFmAlbum;
}

interface LastFmSearchResponse {
    results?: {
        trackmatches?: {
            track?: LastFmTrack | LastFmTrack[];
        };
    };
}

interface LastFmInfoResponse {
    track?: LastFmTrack;
}

interface CoverImage {
    size: "large" | "medium" | "small";
    url: string;
}

async function requestLastFm<T>(
    params: Record<string, string>,
    logUrl = false
): Promise<T> {
    const url = new URL(LASTFM_BASE);

    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    if (logUrl) {
        const loggedUrl = new URL(url);
        loggedUrl.searchParams.set("api_key", "[REDACTED]");
        console.log(`Last.fm track.getInfo URL: ${loggedUrl}`);
    }

    const response = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
        throw new Error(`Last.fm request failed: HTTP ${response.status}`);
    }

    return (await response.json()) as T;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function searchTrack(
    query: string,
    apiKey: string,
    artist?: string
): Promise<LastFmTrack | null> {
    try {
        const params: Record<string, string> = {
            method: "track.search",
            track: query,
            api_key: apiKey,
            format: "json",
            limit: "1",
        };

        if (artist) {
            params.artist = artist;
        }

        const data = await requestLastFm<LastFmSearchResponse>(params);
        const tracks = data.results?.trackmatches?.track;

        if (!tracks) {
            return null;
        }

        return Array.isArray(tracks) ? tracks[0] ?? null : tracks;
    } catch (error) {
        console.error(`Last.fm search failed: ${getErrorMessage(error)}`);
        return null;
    }
}

async function getTrackInfo(
    artist: string,
    title: string,
    apiKey: string,
    verbose: boolean
): Promise<LastFmTrack | null> {
    try {
        const data = await requestLastFm<LastFmInfoResponse>(
            {
                method: "track.getInfo",
                artist,
                track: title,
                api_key: apiKey,
                format: "json",
                autocorrect: "1",
            },
            verbose
        );

        return data.track ?? null;
    } catch (error) {
        console.error(
            `Could not retrieve track information: ${getErrorMessage(error)}`
        );
        return null;
    }
}

function getArtistName(artist: LastFmTrack["artist"]): string {
    if (typeof artist === "string") {
        return artist;
    }

    return artist?.name ?? "";
}

function removeArtistPrefix(title: string, artist: string): string {
    if (
        !artist ||
        title.slice(0, artist.length).toLowerCase() !== artist.toLowerCase()
    ) {
        return title;
    }

    const remainder = title.slice(artist.length);
    const separator = remainder.match(/^\s*[-–—:]\s*/);

    return separator ? remainder.slice(separator[0].length).trim() : title;
}

function getCoverImages(images: LastFmImage[] = []): CoverImage[] {
    const preferredSizes: CoverImage["size"][] = ["large", "medium", "small"];

    return preferredSizes
        .map((size) => ({
            size,
            url: images.find((image) => image.size === size)?.["#text"] ?? "",
        }))
        .filter(
            (image) =>
                image.url.length > 0 && !image.url.endsWith(DEFAULT_COVER)
        );
}

async function downloadImage(images: CoverImage[]): Promise<Buffer | null> {
    for (const image of images) {
        try {
            const response = await fetch(image.url, {
                signal: AbortSignal.timeout(10_000),
            });

            if (!response.ok) {
                continue;
            }

            const contentType = response.headers.get("content-type") ?? "";

            if (!contentType.toLowerCase().startsWith("image/")) {
                continue;
            }

            const maxBytes =
                image.size === "large" ? MAX_LARGE_COVER_BYTES : undefined;
            const reader = response.body?.getReader();

            if (!reader) {
                continue;
            }

            const chunks: Uint8Array[] = [];
            let totalBytes = 0;

            while (true) {
                const { done, value } = await reader.read();

                if (done) {
                    break;
                }

                totalBytes += value.length;

                if (maxBytes !== undefined && totalBytes >= maxBytes) {
                    await reader.cancel();
                    break;
                }

                chunks.push(value);
            }

            if (maxBytes !== undefined && totalBytes >= maxBytes) {
                continue;
            }

            const data = Buffer.concat(chunks);

            if (data.length > 0) {
                return data;
            }
        } catch {
            continue;
        }
    }

    return null;
}

export async function findLastFmMetadata(
    query: string,
    apiKey: string,
    searchArtist?: string,
    verbose = false
): Promise<TrackMetadata | null> {
    const result = await searchTrack(query, apiKey, searchArtist);

    if (!result) {
        return null;
    }

    const artist = getArtistName(result.artist) || searchArtist || "";
    const title = removeArtistPrefix(result.name || query, artist);
    console.log(`Match: ${artist} - ${title}`);
    console.log(`Artist: ${artist}`);
    console.log(`Title: ${title}`);

    const info = await getTrackInfo(artist, title, apiKey, verbose);
    const album = info?.album?.title ?? "";
    const year =
        info?.album?.year ??
        info?.album?.date?.match(/\b\d{4}\b/)?.[0] ??
        "";
    const coverImages = getCoverImages(info?.album?.image ?? []);
    const coverData =
        coverImages.length > 0 ? await downloadImage(coverImages) : null;

    console.log(`Album: ${album}`);
    console.log(`Year: ${year}`);

    return {
        info: { title, artist, album, year } satisfies TrackInfo,
        coverData,
    };
}
