import { getErrorMessage } from "../../shared/errors.js";
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
import { extractYear, valueOrEmpty } from "../track-metadata.js";
import type {
    MetadataProvider,
    ProviderNeeds,
    ProviderServices,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../types.js";

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2/";
const COVER_ART_ARCHIVE_BASE = "https://coverartarchive.org/release/";
const MUSICBRAINZ_REQUEST_INTERVAL = 3_000;
const SERVICE_UNAVAILABLE = 503;
const DEFAULT_RETRY_DELAY = 3_000;
const MAX_RETRY_DELAY = 10_000;

interface MusicBrainzRelease {
    id?: string;
    title?: string;
    date?: string;
}

interface MusicBrainzArtistCredit {
    name?: string;
    artist?: { name?: string };
    joinphrase?: string;
}

interface MusicBrainzRecording {
    title?: string;
    "artist-credit"?: MusicBrainzArtistCredit[];
    "first-release-date"?: string;
    releases?: MusicBrainzRelease[];
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

function getCreditName({ name, artist }: MusicBrainzArtistCredit): string {
    return name ?? valueOrEmpty(artist?.name);
}

function getMusicBrainzArtist(credits: MusicBrainzArtistCredit[] = []): string {
    return credits
        .map((credit) => `${getCreditName(credit)}${credit.joinphrase ?? ""}`)
        .join("")
        .trim();
}

function getFirstRelease(recording: MusicBrainzRecording): MusicBrainzRelease {
    return recording.releases?.[0] ?? {};
}

function getRecordingYear(
    recording: MusicBrainzRecording,
    firstRelease: MusicBrainzRelease
): string {
    return (
        extractYear(recording["first-release-date"]) ||
        extractYear(firstRelease.date)
    );
}

function getRecordingInfo(recording: MusicBrainzRecording): TrackInfo {
    const firstRelease = getFirstRelease(recording);

    return {
        title: recording.title ?? "",
        artist: getMusicBrainzArtist(recording["artist-credit"]),
        album: firstRelease.title ?? "",
        year: getRecordingYear(recording, firstRelease),
    };
}

function getFirstRecording(
    data: MusicBrainzSearchResponse
): MusicBrainzRecording | null {
    return data.recordings?.[0] ?? null;
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

export class MusicBrainzProvider implements MetadataProvider {
    readonly name = "MusicBrainz";
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

    async findMetadata(
        search: TrackSearch,
        { cover: needsCover }: ProviderNeeds
    ): Promise<TrackMetadata | null> {
        const recording = await this.searchRecording(search);

        if (!recording) {
            return null;
        }

        return {
            info: getRecordingInfo(recording),
            extras: {},
            coverData: needsCover
                ? await this.downloadCover(recording.releases)
                : null,
        };
    }

    private async searchRecording(
        search: TrackSearch
    ): Promise<MusicBrainzRecording | null> {
        try {
            const response = await this.fetchWithRetry(
                buildRecordingSearchUrl(search)
            );
            const data = await readJsonResponse<MusicBrainzSearchResponse>(
                response,
                "MusicBrainz"
            );
            return getFirstRecording(data);
        } catch (error) {
            this.services.logger.error(
                `MusicBrainz search failed: ${getErrorMessage(error)}`
            );
            return null;
        }
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

    private downloadCover(
        releases: MusicBrainzRelease[] = []
    ): Promise<Buffer | null> {
        return this.services.images.downloadFirst(
            releases.flatMap(({ id }) =>
                id ? [getCoverArtRequest(id, this.userAgent)] : []
            )
        );
    }
}
