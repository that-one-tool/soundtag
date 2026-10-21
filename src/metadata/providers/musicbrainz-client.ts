import {
    fetchWithTimeout,
    getRetryAfterDelay,
    readJsonResponse,
    type ImageRequest,
} from "../../shared/http.js";
import {
    createRateLimiter,
    type RateLimiter,
} from "../../shared/rate-limiter.js";
import type { ProviderServices, TrackSearch } from "../types.js";

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2/";
const COVER_ART_ARCHIVE_BASE = "https://coverartarchive.org/release/";
const MUSICBRAINZ_REQUEST_INTERVAL = 3_000;
const SERVICE_UNAVAILABLE = 503;
const DEFAULT_RETRY_DELAY = 3_000;
const MAX_RETRY_DELAY = 10_000;
const RELEASE_INCLUDES = "recordings release-groups artist-credits";

export interface MusicBrainzArtistCredit {
    name?: string;
    artist?: { name?: string };
    joinphrase?: string;
}

export interface MusicBrainzRelease {
    id?: string;
    title?: string;
    date?: string;
    "artist-credit"?: MusicBrainzArtistCredit[];
}

export interface MusicBrainzRecording {
    id?: string;
    title?: string;
    "artist-credit"?: MusicBrainzArtistCredit[];
    "first-release-date"?: string;
    releases?: MusicBrainzRelease[];
}

export interface MusicBrainzTrack {
    position?: number;
    recording?: { id?: string; "first-release-date"?: string };
}

export interface MusicBrainzMedium {
    position?: number;
    "track-count"?: number;
    tracks?: MusicBrainzTrack[];
}

export interface MusicBrainzReleaseDetails extends MusicBrainzRelease {
    "release-group"?: { "first-release-date"?: string };
    media?: MusicBrainzMedium[];
}

interface MusicBrainzSearchResponse {
    recordings?: MusicBrainzRecording[];
}

function buildSearchTerm(field: string, value: string): string {
    return `${field}:"${value.replaceAll('"', '\\"')}"`;
}

function buildRecordingSearchUrl({ title, artist, album }: TrackSearch): URL {
    const terms = [
        buildSearchTerm("recording", title),
        ...(artist ? [buildSearchTerm("artist", artist)] : []),
        ...(album ? [buildSearchTerm("release", album)] : []),
    ];
    const url = new URL("recording", MUSICBRAINZ_BASE);
    url.searchParams.set("query", terms.join(" AND "));
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", "1");
    return url;
}

function buildReleaseUrl(releaseId: string): URL {
    const url = new URL(
        `release/${encodeURIComponent(releaseId)}`,
        MUSICBRAINZ_BASE
    );
    url.searchParams.set("inc", RELEASE_INCLUDES);
    url.searchParams.set("fmt", "json");
    return url;
}

export class MusicBrainzClient {
    private readonly schedule: RateLimiter;

    constructor(
        private readonly userAgent: string,
        private readonly services: ProviderServices
    ) {
        this.schedule = createRateLimiter(
            MUSICBRAINZ_REQUEST_INTERVAL,
            services.clock
        );
    }

    // Fix mode searches before the chain, with the same terms unless it corrects them.
    async searchRecordings(
        search: TrackSearch
    ): Promise<MusicBrainzRecording[]> {
        const url = buildRecordingSearchUrl(search);
        const data = await this.services.cache.getOrLoad(
            `musicbrainz:search:${url}`,
            () => this.requestJson<MusicBrainzSearchResponse>(url)
        );
        return data.recordings ?? [];
    }

    getRelease(releaseId: string): Promise<MusicBrainzReleaseDetails> {
        return this.services.cache.getOrLoad(
            `musicbrainz:release:${releaseId}`,
            () => this.requestJson(buildReleaseUrl(releaseId))
        );
    }

    getCoverRequest(releaseId: string, image = "front"): ImageRequest {
        return {
            url: new URL(
                `${encodeURIComponent(releaseId)}/${image}-500`,
                COVER_ART_ARCHIVE_BASE
            ),
            headers: { "User-Agent": this.userAgent },
        };
    }

    private async requestJson<Payload>(url: URL): Promise<Payload> {
        const response = await this.fetchWithRetry(url);
        return readJsonResponse<Payload>(response, "MusicBrainz");
    }

    private async fetchWithRetry(url: URL): Promise<Response> {
        const response = await this.scheduleFetch(url);

        if (response.status !== SERVICE_UNAVAILABLE) {
            return response;
        }

        await response.body?.cancel();
        await this.services.clock.sleep(
            getRetryAfterDelay(response, DEFAULT_RETRY_DELAY, MAX_RETRY_DELAY)
        );
        return this.scheduleFetch(url);
    }

    private scheduleFetch(url: URL): Promise<Response> {
        return this.schedule(() =>
            fetchWithTimeout(url, { headers: { "User-Agent": this.userAgent } })
        );
    }
}
