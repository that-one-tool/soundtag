import { TimeoutError } from "../../shared/errors.js";
import {
    fetchWithTimeout,
    getRetryAfterDelay,
    readJsonResponse,
    type ImageRequest,
} from "../../shared/http.js";
import {
    createRateLimiter,
    sleepAndReport,
    type RateLimiter,
} from "../../shared/rate-limiter.js";
import { valueOrEmpty } from "../track-metadata.js";
import type { AlbumSearch, ProviderServices, TrackSearch } from "../types.js";

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2/";
const COVER_ART_ARCHIVE_BASE = "https://coverartarchive.org/release/";
const COVER_ART_ARCHIVE_GROUP_BASE =
    "https://coverartarchive.org/release-group/";
const RELEASE_GROUP_SEARCH_LIMIT = 5;
const MUSICBRAINZ_REQUEST_INTERVAL = 3_500;
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

// Groups every edition of an album.
export interface MusicBrainzReleaseGroup {
    id?: string;
    title?: string;
    "first-release-date"?: string;
    "artist-credit"?: MusicBrainzArtistCredit[];
}

interface MusicBrainzSearchResponse {
    recordings?: MusicBrainzRecording[];
}

interface MusicBrainzReleaseGroupResponse {
    "release-groups"?: MusicBrainzReleaseGroup[];
}

function getCreditName({ name, artist }: MusicBrainzArtistCredit): string {
    return name ?? valueOrEmpty(artist?.name);
}

export function getMusicBrainzArtist(
    credits: MusicBrainzArtistCredit[] = []
): string {
    return credits
        .map((credit) => `${getCreditName(credit)}${credit.joinphrase ?? ""}`)
        .join("")
        .trim();
}

function buildSearchTerm(field: string, value: string): string {
    const escaped = value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    return `${field}:"${escaped}"`;
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

function buildReleaseGroupSearchUrl({ artist, album }: AlbumSearch): URL {
    const terms = [
        buildSearchTerm("releasegroup", album),
        buildSearchTerm("artist", artist),
    ];
    const url = new URL("release-group", MUSICBRAINZ_BASE);
    url.searchParams.set("query", terms.join(" AND "));
    url.searchParams.set("fmt", "json");
    url.searchParams.set("limit", String(RELEASE_GROUP_SEARCH_LIMIT));
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
            services.clock,
            services.lookups.noteWait
        );
    }

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

    async searchReleaseGroups(
        search: AlbumSearch
    ): Promise<MusicBrainzReleaseGroup[]> {
        const url = buildReleaseGroupSearchUrl(search);
        const data =
            await this.requestJson<MusicBrainzReleaseGroupResponse>(url);
        return data["release-groups"] ?? [];
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

    getReleaseGroupCoverRequest(groupId: string, size: number): ImageRequest {
        return {
            url: new URL(
                `${encodeURIComponent(groupId)}/front-${size}`,
                COVER_ART_ARCHIVE_GROUP_BASE
            ),
            headers: { "User-Agent": this.userAgent },
        };
    }

    private async requestJson<Payload>(url: URL): Promise<Payload> {
        const response = await this.fetchWithRetry(url);
        return readJsonResponse<Payload>(response, "MusicBrainz");
    }

    private async fetchWithRetry(url: URL): Promise<Response> {
        const response = await this.fetchRetryingTimeout(url);

        if (response.status !== SERVICE_UNAVAILABLE) {
            return response;
        }

        await response.body?.cancel();
        const delay = getRetryAfterDelay(
            response,
            DEFAULT_RETRY_DELAY,
            MAX_RETRY_DELAY
        );
        // ListenBrainz release lookups also go through this client.
        this.services.lookups.note("MusicBrainz HTTP 503, retried");
        const { clock, lookups } = this.services;
        await sleepAndReport(clock, delay, lookups.noteWait);
        return this.scheduleFetch(url);
    }

    // MusicBrainz sometimes stalls on a request it answers at once when asked again.
    private fetchRetryingTimeout(url: URL): Promise<Response> {
        return this.scheduleFetch(url).catch((error: unknown) => {
            if (!(error instanceof TimeoutError)) {
                throw error;
            }

            this.services.lookups.note("MusicBrainz timed out, retried");
            return this.scheduleFetch(url);
        });
    }

    private scheduleFetch(url: URL): Promise<Response> {
        this.services.lookups.request(url);
        return this.schedule(() =>
            fetchWithTimeout(url, { headers: { "User-Agent": this.userAgent } })
        );
    }
}
