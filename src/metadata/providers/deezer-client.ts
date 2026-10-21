import { ServiceError } from "../../shared/errors.js";
import { fetchWithTimeout, readJsonResponse } from "../../shared/http.js";
import type { ImageRequest } from "../../shared/http.js";
import {
    createRateLimiter,
    type RateLimiter,
} from "../../shared/rate-limiter.js";
import type { ProviderServices } from "../types.js";

const DEEZER_API_URL = "https://api.deezer.com/";
const DEEZER_REQUEST_INTERVAL = 500;
const SEARCH_LIMIT = "5";
const ALBUM_TRACKS_LIMIT = "1000";

interface DeezerNamed {
    name?: string;
}

export interface DeezerAlbumSummary {
    id?: number;
    title?: string;
    cover_xl?: string;
    cover_big?: string;
    artist?: DeezerNamed;
}

export interface DeezerTrack {
    id?: number;
    title?: string;
    artist?: DeezerNamed;
    album?: DeezerAlbumSummary;
}

export interface DeezerAlbum extends DeezerAlbumSummary {
    genres?: { data?: DeezerNamed[] };
}

export interface DeezerAlbumTrack {
    id?: number;
    track_position?: number;
    disk_number?: number;
}

interface DeezerList<Item> {
    data?: Item[];
}

// Deezer reports failures with HTTP 200 and an error object.
interface DeezerErrorPayload {
    error?: { message?: string };
}

function assertNoDeezerError({ error }: DeezerErrorPayload): void {
    if (error) {
        throw new ServiceError(`Deezer error: ${error.message ?? "unknown"}`);
    }
}

function buildDeezerUrl(path: string, params: Record<string, string>): URL {
    const url = new URL(path, DEEZER_API_URL);
    for (const [name, value] of Object.entries(params)) {
        url.searchParams.set(name, value);
    }
    return url;
}

export function buildQuery(parts: string[]): string {
    return parts.filter(Boolean).join(" ");
}

export function getCoverRequests(
    album: DeezerAlbumSummary | undefined
): ImageRequest[] {
    const urls = [album?.cover_xl, album?.cover_big];
    return urls.filter((url) => url !== undefined).map((url) => ({ url }));
}

export class DeezerClient {
    private readonly schedule: RateLimiter;

    constructor(private readonly services: ProviderServices) {
        this.schedule = createRateLimiter(
            DEEZER_REQUEST_INTERVAL,
            services.clock,
            services.lookups.noteWait
        );
    }

    searchTracks(query: string): Promise<DeezerTrack[]> {
        return this.requestList("search", { q: query, limit: SEARCH_LIMIT });
    }

    searchAlbums(query: string): Promise<DeezerAlbumSummary[]> {
        const params = { q: query, limit: SEARCH_LIMIT };
        return this.requestList("search/album", params);
    }

    getAlbum(albumId: number): Promise<DeezerAlbum> {
        return this.services.cache.getOrLoad(`deezer:album:${albumId}`, () =>
            this.request(`album/${albumId}`, {})
        );
    }

    getAlbumTracks(albumId: number): Promise<DeezerAlbumTrack[]> {
        return this.services.cache.getOrLoad(
            `deezer:album-tracks:${albumId}`,
            () =>
                this.requestList(`album/${albumId}/tracks`, {
                    limit: ALBUM_TRACKS_LIMIT,
                })
        );
    }

    private async requestList<Item>(
        path: string,
        params: Record<string, string>
    ): Promise<Item[]> {
        const list = await this.request<DeezerList<Item>>(path, params);
        return list.data ?? [];
    }

    private async request<Payload>(
        path: string,
        params: Record<string, string>
    ): Promise<Payload> {
        const url = buildDeezerUrl(path, params);
        this.services.lookups.request(url);
        const payload = await this.schedule(async () =>
            readJsonResponse<Payload & DeezerErrorPayload>(
                await fetchWithTimeout(url),
                "Deezer"
            )
        );
        assertNoDeezerError(payload);
        return payload;
    }
}
