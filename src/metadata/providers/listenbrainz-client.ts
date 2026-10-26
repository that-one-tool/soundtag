import { ServiceError } from "../../shared/errors.js";
import { fetchWithTimeout, readJsonResponse } from "../../shared/http.js";
import {
    createRateLimiter,
    type RateLimiter,
} from "../../shared/rate-limiter.js";
import type { ProviderServices, TrackSearch } from "../types.js";

const LOOKUP_URL = "https://api.listenbrainz.org/1/metadata/lookup/";
const LISTENBRAINZ_REQUEST_INTERVAL = 1_000;
const UNAUTHORIZED = 401;

export interface ListenBrainzTag {
    tag?: string;
    count?: number;
    genre_mbid?: string;
}

export interface ListenBrainzTags {
    recording?: ListenBrainzTag[];
    release_group?: ListenBrainzTag[];
    artist?: ListenBrainzTag[];
}

export interface ListenBrainzRelease {
    album_artist_name?: string;
    caa_id?: number;
    caa_release_mbid?: string;
}

export interface ListenBrainzMatch {
    recording_mbid?: string;
    recording_name?: string;
    artist_credit_name?: string;
    release_mbid?: string;
    release_name?: string;
    metadata?: { release?: ListenBrainzRelease; tag?: ListenBrainzTags };
}

export interface ListenBrainzCredentials {
    token: string;
    userAgent: string;
}

function buildLookupUrl({ title, artist, album }: TrackSearch): URL {
    const url = new URL(LOOKUP_URL);
    url.searchParams.set("artist_name", artist);
    url.searchParams.set("recording_name", title);
    if (album) {
        url.searchParams.set("release_name", album);
    }
    url.searchParams.set("metadata", "true");
    url.searchParams.set("inc", "artist tag release");
    return url;
}

function readLookupResponse(response: Response): Promise<ListenBrainzMatch> {
    if (response.status === UNAUTHORIZED) {
        throw new ServiceError(
            "ListenBrainz rejected the token: check LISTENBRAINZ_TOKEN."
        );
    }

    return readJsonResponse<ListenBrainzMatch>(response, "ListenBrainz");
}

// No match is an empty object rather than an HTTP error.
function getMatch(payload: ListenBrainzMatch): ListenBrainzMatch | null {
    return payload.recording_mbid ? payload : null;
}

export class ListenBrainzClient {
    private readonly schedule: RateLimiter;

    constructor(
        private readonly credentials: ListenBrainzCredentials,
        private readonly services: ProviderServices
    ) {
        this.schedule = createRateLimiter(
            LISTENBRAINZ_REQUEST_INTERVAL,
            services.clock,
            services.lookups.noteWait
        );
    }

    async lookUp(search: TrackSearch): Promise<ListenBrainzMatch | null> {
        const url = buildLookupUrl(search);
        const payload = await this.services.cache.getOrLoad(
            `listenbrainz:lookup:${url}`,
            () => this.request(url)
        );
        return getMatch(payload);
    }

    private request(url: URL): Promise<ListenBrainzMatch> {
        this.services.lookups.request(url);
        return this.schedule(async () =>
            readLookupResponse(
                await fetchWithTimeout(url, { headers: this.getHeaders() })
            )
        );
    }

    private getHeaders(): Record<string, string> {
        return {
            Authorization: `Token ${this.credentials.token}`,
            "User-Agent": this.credentials.userAgent,
        };
    }
}
