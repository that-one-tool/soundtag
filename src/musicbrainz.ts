import { setTimeout as delay } from "node:timers/promises";
import type { TrackInfo } from "./types.js";

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2/";
const COVER_ART_ARCHIVE_BASE = "https://coverartarchive.org/release/";
const MUSICBRAINZ_REQUEST_INTERVAL = 1000;
let lastMusicBrainzRequestAt = 0;
let musicBrainzRequestQueue: Promise<void> = Promise.resolve();

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

async function requestMusicBrainz<T>(url: URL, userAgent: string): Promise<T> {
    const request = musicBrainzRequestQueue.then(async () => {
        const timeSinceLastRequest = Date.now() - lastMusicBrainzRequestAt;

        if (timeSinceLastRequest < MUSICBRAINZ_REQUEST_INTERVAL) {
            await delay(MUSICBRAINZ_REQUEST_INTERVAL - timeSinceLastRequest);
        }

        lastMusicBrainzRequestAt = Date.now();
        const response = await fetch(url, {
            headers: { "User-Agent": userAgent },
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            throw new Error(
                `MusicBrainz request failed: HTTP ${response.status}`
            );
        }

        return (await response.json()) as T;
    });

    musicBrainzRequestQueue = request.then(
        () => undefined,
        () => undefined
    );

    return request;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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

export async function downloadMusicBrainzCover(
    releases: MusicBrainzRelease[],
    userAgent: string
): Promise<Buffer | null> {
    for (const release of releases) {
        if (!release.id) {
            continue;
        }

        const url = new URL(
            `${encodeURIComponent(release.id)}/front-500`,
            COVER_ART_ARCHIVE_BASE
        );

        try {
            const response = await fetch(url, {
                headers: { "User-Agent": userAgent },
                signal: AbortSignal.timeout(10_000),
            });

            if (!response.ok) {
                continue;
            }

            const contentType = response.headers.get("content-type") ?? "";

            if (!contentType.toLowerCase().startsWith("image/")) {
                continue;
            }

            const data = Buffer.from(await response.arrayBuffer());

            if (data.length > 0) {
                return data;
            }
        } catch {
            continue;
        }
    }

    return null;
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
