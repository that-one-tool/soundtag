import { getErrorMessage } from "../../shared/errors.js";
import type { Logger } from "../../shared/logger.js";
import {
    downloadFirstImage,
    fetchWithTimeout,
    readJsonResponse,
    type ImageRequest,
} from "../../shared/http.js";
import { extractYear, valueOrEmpty } from "../track-metadata.js";
import type {
    MetadataProvider,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../types.js";

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

function buildLastFmUrl(params: Record<string, string>): URL {
    const url = new URL(LASTFM_BASE);

    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    return url;
}

function logRequestUrl(url: URL, logger: Logger): void {
    const loggedUrl = new URL(url);
    loggedUrl.searchParams.set("api_key", "[REDACTED]");
    logger.info(`Last.fm track.getInfo URL: ${loggedUrl}`);
}

async function requestLastFm<T>(
    params: Record<string, string>,
    urlLogger: Logger | null
): Promise<T> {
    const url = buildLastFmUrl(params);

    if (urlLogger) {
        logRequestUrl(url, urlLogger);
    }

    return readJsonResponse<T>(await fetchWithTimeout(url), "Last.fm");
}

function buildSearchParams(
    query: string,
    apiKey: string,
    artist: string
): Record<string, string> {
    return {
        method: "track.search",
        track: query,
        api_key: apiKey,
        format: "json",
        limit: "1",
        ...(artist ? { artist } : {}),
    };
}

function getTrackMatches(
    data: LastFmSearchResponse
): LastFmTrack | LastFmTrack[] | undefined {
    return data.results?.trackmatches?.track;
}

function getFirstMatch(data: LastFmSearchResponse): LastFmTrack | null {
    const matches = [getTrackMatches(data) ?? []].flat();
    return matches[0] ?? null;
}

async function searchTrack(
    { title, artist }: TrackSearch,
    apiKey: string,
    logger: Logger
): Promise<LastFmTrack | null> {
    try {
        const data = await requestLastFm<LastFmSearchResponse>(
            buildSearchParams(title, apiKey, artist),
            null
        );
        return getFirstMatch(data);
    } catch (error) {
        logger.error(`Last.fm search failed: ${getErrorMessage(error)}`);
        return null;
    }
}

function buildTrackInfoParams(
    { artist, title }: Pick<TrackInfo, "title" | "artist">,
    apiKey: string
): Record<string, string> {
    return {
        method: "track.getInfo",
        artist,
        track: title,
        api_key: apiKey,
        format: "json",
        autocorrect: "1",
    };
}

function getArtistName(artist: LastFmTrack["artist"]): string {
    if (typeof artist === "string") {
        return artist;
    }

    return valueOrEmpty(artist?.name);
}

function startsWithArtist(title: string, artist: string): boolean {
    const titleStart = title.slice(0, artist.length);
    return Boolean(artist) && titleStart.toLowerCase() === artist.toLowerCase();
}

function removeArtistPrefix(title: string, artist: string): string {
    if (!startsWithArtist(title, artist)) {
        return title;
    }

    const remainder = title.slice(artist.length);
    const separator = /^\s*[-–—:]\s*/.exec(remainder);
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

function getCoverImageRequests(images: CoverImage[]): ImageRequest[] {
    return images.map(({ size, url }) => ({
        url,
        byteLimit: size === "large" ? MAX_LARGE_COVER_BYTES : undefined,
    }));
}

function getMatchedTrack(
    match: LastFmTrack,
    search: TrackSearch
): Pick<TrackInfo, "title" | "artist"> {
    const artist = getArtistName(match.artist) || search.artist;
    return {
        artist,
        title: removeArtistPrefix(match.name || search.title, artist),
    };
}

function getAlbumYear(album: LastFmAlbum): string {
    return album.year ?? extractYear(album.date);
}

function getAlbumInfo(
    matched: Pick<TrackInfo, "title" | "artist">,
    album: LastFmAlbum = {}
): TrackInfo {
    return {
        ...matched,
        album: album.title ?? "",
        year: getAlbumYear(album),
    };
}

function downloadAlbumCover(album: LastFmAlbum = {}): Promise<Buffer | null> {
    return downloadFirstImage(
        getCoverImageRequests(getCoverImages(album.image))
    );
}

function logMatch(
    { title, artist }: Pick<TrackInfo, "title" | "artist">,
    logger: Logger
): void {
    logger.info(`Match: ${artist} - ${title}`);
    logger.info(`Artist: ${artist}`);
    logger.info(`Title: ${title}`);
}

function logAlbumDetails(
    { album, year }: Pick<TrackInfo, "album" | "year">,
    logger: Logger
): void {
    logger.info(`Album: ${album}`);
    logger.info(`Year: ${year}`);
}

export class LastFmProvider implements MetadataProvider {
    constructor(
        private readonly apiKey: string,
        private readonly verbose: boolean,
        private readonly logger: Logger
    ) {}

    async findMetadata(
        search: TrackSearch,
        needsCover: boolean
    ): Promise<TrackMetadata | null> {
        const match = await searchTrack(search, this.apiKey, this.logger);

        if (!match) {
            logAlbumDetails({ album: "", year: "" }, this.logger);
            return null;
        }

        return this.getMatchMetadata(
            getMatchedTrack(match, search),
            needsCover
        );
    }

    private async getMatchMetadata(
        matched: Pick<TrackInfo, "title" | "artist">,
        needsCover: boolean
    ): Promise<TrackMetadata> {
        logMatch(matched, this.logger);
        const track = await this.getTrackInfo(matched);
        const album = track?.album;
        const info = getAlbumInfo(matched, album);
        const coverData = needsCover ? await downloadAlbumCover(album) : null;
        logAlbumDetails(info, this.logger);
        return { info, coverData };
    }

    private getUrlLogger(): Logger | null {
        return this.verbose ? this.logger : null;
    }

    private async getTrackInfo(
        matched: Pick<TrackInfo, "title" | "artist">
    ): Promise<LastFmTrack | null> {
        try {
            const data = await requestLastFm<LastFmInfoResponse>(
                buildTrackInfoParams(matched, this.apiKey),
                this.getUrlLogger()
            );
            return data.track ?? null;
        } catch (error) {
            this.logger.error(
                `Could not retrieve track information: ${getErrorMessage(error)}`
            );
            return null;
        }
    }
}
