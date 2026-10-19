import { setTimeout as delay } from "node:timers/promises";
import { getErrorMessage } from "./errors.js";
import {
    downloadFirstImage,
    fetchWithTimeout,
    getRetryAfterDelay,
    readJsonResponse,
    type ImageRequest,
} from "./http.js";
import { createRateLimiter } from "./rate-limiter.js";
import type { TrackInfo } from "./types.js";

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2/";
const COVER_ART_ARCHIVE_BASE = "https://coverartarchive.org/release/";
const MUSICBRAINZ_REQUEST_INTERVAL = 1000;
const SERVICE_UNAVAILABLE = 503;
const DEFAULT_RETRY_DELAY = 2_000;
const MAX_RETRY_DELAY = 10_000;
const scheduleMusicBrainzRequest = createRateLimiter(
    MUSICBRAINZ_REQUEST_INTERVAL
);

export interface MusicBrainzRelease {
    id?: string;
    title?: string;
    date?: string;
}

interface MusicBrainzArtistCredit {
    name?: string;
    artist?: { name?: string };
    joinphrase?: string;
}

export interface MusicBrainzRecording {
    title?: string;
    "artist-credit"?: MusicBrainzArtistCredit[];
    "first-release-date"?: string;
    releases?: MusicBrainzRelease[];
}

interface MusicBrainzSearchResponse {
    recordings?: MusicBrainzRecording[];
}

function scheduleMusicBrainzFetch(
    url: URL,
    userAgent: string
): Promise<Response> {
    return scheduleMusicBrainzRequest(() =>
        fetchWithTimeout(url, { headers: { "User-Agent": userAgent } })
    );
}

async function fetchMusicBrainzWithRetry(
    url: URL,
    userAgent: string
): Promise<Response> {
    const response = await scheduleMusicBrainzFetch(url, userAgent);

    if (response.status !== SERVICE_UNAVAILABLE) {
        return response;
    }

    await response.body?.cancel();
    await delay(
        getRetryAfterDelay(response, DEFAULT_RETRY_DELAY, MAX_RETRY_DELAY)
    );
    return scheduleMusicBrainzFetch(url, userAgent);
}

async function requestMusicBrainz<T>(url: URL, userAgent: string): Promise<T> {
    const response = await fetchMusicBrainzWithRetry(url, userAgent);
    return readJsonResponse<T>(response, "MusicBrainz");
}

function getMusicBrainzArtist(recording: MusicBrainzRecording): string {
    return (
        recording["artist-credit"]
            ?.map(
                (credit) =>
                    `${credit.name ?? credit.artist?.name ?? ""}${credit.joinphrase ?? ""}`
            )
            .join("")
            .trim() ?? ""
    );
}

export async function searchMusicBrainz(
    title: string,
    artist: string,
    userAgent: string,
    album?: string
): Promise<MusicBrainzRecording | null> {
    const terms = [
        `recording:"${title.replaceAll('"', '\\"')}"`,
        artist && `artist:"${artist.replaceAll('"', '\\"')}"`,
        album && `release:"${album.replaceAll('"', '\\"')}"`,
    ].filter((term): term is string => Boolean(term));
    const query = terms.join(" AND ");
    const url = new URL("recording", MUSICBRAINZ_BASE);
    url.searchParams.set("query", query);
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "1");

    try {
        const data = await requestMusicBrainz<MusicBrainzSearchResponse>(
            url,
            userAgent
        );
        return data.recordings?.[0] ?? null;
    } catch (error) {
        console.error(`MusicBrainz search failed: ${getErrorMessage(error)}`);
        return null;
    }
}

function getCoverArtRequest(
    releaseId: string,
    userAgent: string
): ImageRequest {
    return {
        url: new URL(
            `${encodeURIComponent(releaseId)}/front-500`,
            COVER_ART_ARCHIVE_BASE
        ),
        headers: { "User-Agent": userAgent },
    };
}

export function downloadMusicBrainzCover(
    releases: MusicBrainzRelease[],
    userAgent: string
): Promise<Buffer | null> {
    return downloadFirstImage(
        releases.flatMap(({ id }) =>
            id ? [getCoverArtRequest(id, userAgent)] : []
        )
    );
}

export async function findMusicBrainzMetadata(
    title: string,
    artist: string,
    userAgent: string,
    includeCover: boolean,
    album?: string
): Promise<{ info: TrackInfo; coverData: Buffer | null } | null> {
    const recording = await searchMusicBrainz(title, artist, userAgent, album);

    if (!recording) {
        return null;
    }

    return {
        info: {
            title: recording.title ?? "",
            artist: getMusicBrainzArtist(recording),
            album: recording.releases?.[0]?.title ?? "",
            year:
                recording["first-release-date"]?.match(/\b\d{4}\b/)?.[0] ??
                recording.releases?.[0]?.date?.match(/\b\d{4}\b/)?.[0] ??
                "",
        },
        coverData: includeCover
            ? await downloadMusicBrainzCover(
                  recording.releases ?? [],
                  userAgent
              )
            : null,
    };
}
