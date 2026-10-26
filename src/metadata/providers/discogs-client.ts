import { fetchWithTimeout, readJsonResponse } from "../../shared/http.js";
import type { ImageRequest } from "../../shared/http.js";
import {
    createRateLimiter,
    type RateLimiter,
} from "../../shared/rate-limiter.js";
import type { ProviderServices, TrackSearch } from "../types.js";

const DISCOGS_API_URL = "https://api.discogs.com/";
// Discogs allows 60 authenticated requests per minute.
const DISCOGS_REQUEST_INTERVAL = 1_000;
const USER_AGENT = "SoundTag/1.0";
const SEARCH_LIMIT = "1";

const ALBUM_PATHS = { master: "masters", release: "releases" } as const;

// A master groups every edition of an album and carries its original year.
export type DiscogsAlbumKind = keyof typeof ALBUM_PATHS;

export interface DiscogsCredentials {
    key: string;
    secret: string;
}

export interface DiscogsArtist {
    name?: string;
    join?: string;
}

export interface DiscogsTrack {
    position?: string;
    type_?: string;
    title?: string;
    artists?: DiscogsArtist[];
    sub_tracks?: DiscogsTrack[];
}

export interface DiscogsAlbum {
    id?: number;
    title?: string;
    year?: number;
    artists?: DiscogsArtist[];
    genres?: string[];
    images?: { type?: string; uri?: string }[];
    tracklist?: DiscogsTrack[];
}

export interface DiscogsSearchResult {
    id?: number;
}

interface DiscogsSearchResponse {
    results?: DiscogsSearchResult[];
}

// A known album is searched without the title, so its tracks share one cached search.
function buildSearchUrl(kind: DiscogsAlbumKind, search: TrackSearch): URL {
    const url = new URL("database/search", DISCOGS_API_URL);
    const params = {
        type: kind,
        artist: search.artist,
        track: search.album ? "" : search.title,
        release_title: search.album,
        per_page: SEARCH_LIMIT,
    };
    const filled = Object.entries(params).filter(([, value]) => value);
    for (const [name, value] of filled) {
        url.searchParams.set(name, value);
    }
    return url;
}

// Consumer key and secret authenticate without a user, which searches need.
export class DiscogsClient {
    private readonly schedule: RateLimiter;
    private readonly headers: Record<string, string>;

    constructor(
        { key, secret }: DiscogsCredentials,
        private readonly services: ProviderServices
    ) {
        this.headers = {
            "User-Agent": USER_AGENT,
            Authorization: `Discogs key=${key}, secret=${secret}`,
        };
        this.schedule = createRateLimiter(
            DISCOGS_REQUEST_INTERVAL,
            services.clock,
            services.lookups.noteWait
        );
    }

    async searchAlbums(
        kind: DiscogsAlbumKind,
        search: TrackSearch
    ): Promise<DiscogsSearchResult[]> {
        const url = buildSearchUrl(kind, search);
        const response = await this.request<DiscogsSearchResponse>(url);
        return response.results ?? [];
    }

    getAlbum(kind: DiscogsAlbumKind, id: number): Promise<DiscogsAlbum> {
        const url = new URL(`${ALBUM_PATHS[kind]}/${id}`, DISCOGS_API_URL);
        return this.request(url);
    }

    getCoverRequest(url: string): ImageRequest {
        return { url, headers: { "User-Agent": USER_AGENT } };
    }

    private request<Payload>(url: URL): Promise<Payload> {
        return this.services.cache.getOrLoad(`discogs:${url}`, () =>
            this.fetchJson(url)
        );
    }

    private fetchJson<Payload>(url: URL): Promise<Payload> {
        this.services.lookups.request(url);
        return this.schedule(async () =>
            readJsonResponse<Payload>(
                await fetchWithTimeout(url, { headers: this.headers }),
                "Discogs"
            )
        );
    }
}
