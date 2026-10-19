import { getErrorMessage } from "../../shared/errors.js";
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

function logRequestUrl(url: URL): void {
    const loggedUrl = new URL(url);
    loggedUrl.searchParams.set("api_key", "[REDACTED]");
    console.log(`Last.fm track.getInfo URL: ${loggedUrl}`);
}

async function requestLastFm<T>(
    params: Record<string, string>,
    logUrl: boolean
): Promise<T> {
    const url = buildLastFmUrl(params);

    if (logUrl) {
        logRequestUrl(url);
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
    query: string,
    apiKey: string,
    artist: string
): Promise<LastFmTrack | null> {
    try {
        const data = await requestLastFm<LastFmSearchResponse>(
            buildSearchParams(query, apiKey, artist),
            false
        );
        return getFirstMatch(data);
    } catch (error) {
        console.error(`Last.fm search failed: ${getErrorMessage(error)}`);
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

async function getTrackInfo(
    matched: Pick<TrackInfo, "title" | "artist">,
    apiKey: string,
    verbose: boolean
): Promise<LastFmTrack | null> {
    try {
        const data = await requestLastFm<LastFmInfoResponse>(
            buildTrackInfoParams(matched, apiKey),
            verbose
        );
        return data.track ?? null;
    } catch (error) {
        console.error(
            `Could not retrieve track information: ${getErrorMessage(error)}`
        );
        return null;
    }
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

function logMatch({
    title,
    artist,
}: Pick<TrackInfo, "title" | "artist">): void {
    console.log(`Match: ${artist} - ${title}`);
    console.log(`Artist: ${artist}`);
    console.log(`Title: ${title}`);
}

function logAlbumDetails(album: string, year: string): void {
    console.log(`Album: ${album}`);
    console.log(`Year: ${year}`);
}

export class LastFmProvider implements MetadataProvider {
    constructor(
        private readonly apiKey: string,
        private readonly verbose = false
    ) {}

    async findMetadata(
        search: TrackSearch,
        needsCover: boolean
    ): Promise<TrackMetadata | null> {
        const match = await searchTrack(
            search.title,
            this.apiKey,
            search.artist
        );

        if (!match) {
            logAlbumDetails("", "");
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
        logMatch(matched);
        const track = await getTrackInfo(matched, this.apiKey, this.verbose);
        const album = track?.album;
        const info = getAlbumInfo(matched, album);
        const coverData = needsCover ? await downloadAlbumCover(album) : null;
        logAlbumDetails(info.album, info.year);
        return { info, coverData };
    }
}
