import { getErrorMessage } from "../../shared/errors.js";
import {
    downloadFirstImage,
    fetchWithTimeout,
    readJsonResponse,
} from "../../shared/http.js";
import {
    createRateLimiter,
    systemClock,
    type Clock,
    type RateLimiter,
} from "../../shared/rate-limiter.js";
import { extractYear, valueOrEmpty } from "../track-metadata.js";
import type {
    MetadataProvider,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../types.js";

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

function buildItunesSearchUrl({ title, artist, album }: TrackSearch): URL {
    const url = new URL(ITUNES_SEARCH_URL);
    url.searchParams.set(
        "term",
        [artist, title, album].filter(Boolean).join(" ")
    );
    url.searchParams.set("country", "US");
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "1");
    return url;
}

function getFirstItunesTrack(data: ItunesSearchResponse): ItunesTrack | null {
    return data.results?.[0] ?? null;
}

function getItunesTrackInfo(track: ItunesTrack): TrackInfo {
    return {
        title: valueOrEmpty(track.trackName),
        artist: valueOrEmpty(track.artistName),
        album: valueOrEmpty(track.collectionName),
        year: extractYear(track.releaseDate),
    };
}

function downloadArtwork(url: string | undefined): Promise<Buffer | null> {
    return url ? downloadFirstImage([{ url }]) : Promise.resolve(null);
}

export class ItunesProvider implements MetadataProvider {
    private readonly schedule: RateLimiter;

    constructor(clock: Clock = systemClock) {
        this.schedule = createRateLimiter(ITUNES_REQUEST_INTERVAL, clock);
    }

    async findMetadata(
        search: TrackSearch,
        needsCover: boolean
    ): Promise<TrackMetadata | null> {
        const track = await this.searchTrack(search);

        if (!track) {
            return null;
        }

        return {
            info: getItunesTrackInfo(track),
            coverData: needsCover
                ? await downloadArtwork(track.artworkUrl100)
                : null,
        };
    }

    private async searchTrack(
        search: TrackSearch
    ): Promise<ItunesTrack | null> {
        const url = buildItunesSearchUrl(search);

        try {
            const data = await this.schedule(async () =>
                readJsonResponse<ItunesSearchResponse>(
                    await fetchWithTimeout(url),
                    "iTunes Search"
                )
            );
            return getFirstItunesTrack(data);
        } catch (error) {
            console.error(`iTunes Search failed: ${getErrorMessage(error)}`);
            return null;
        }
    }
}
