import { getErrorMessage } from "./errors.js";
import {
    downloadFirstImage,
    fetchWithTimeout,
    readJsonResponse,
    type ImageRequest,
} from "./http.js";
import { extractYear } from "./track-metadata.js";
import type {
    MetadataProvider,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "./types.js";

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

async function requestLastFm<T>(
    params: Record<string, string>,
    logUrl = false
): Promise<T> {
    const url = new URL(LASTFM_BASE);

    for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
    }

    if (logUrl) {
        const loggedUrl = new URL(url);
        loggedUrl.searchParams.set("api_key", "[REDACTED]");
        console.log(`Last.fm track.getInfo URL: ${loggedUrl}`);
    }

    return readJsonResponse<T>(await fetchWithTimeout(url), "Last.fm");
}

async function searchTrack(
    query: string,
    apiKey: string,
    artist?: string
): Promise<LastFmTrack | null> {
    try {
        const params: Record<string, string> = {
            method: "track.search",
            track: query,
            api_key: apiKey,
            format: "json",
            limit: "1",
        };

        if (artist) {
            params.artist = artist;
        }

        const data = await requestLastFm<LastFmSearchResponse>(params);
        const tracks = data.results?.trackmatches?.track;

        if (!tracks) {
            return null;
        }

        return Array.isArray(tracks) ? (tracks[0] ?? null) : tracks;
    } catch (error) {
        console.error(`Last.fm search failed: ${getErrorMessage(error)}`);
        return null;
    }
}

async function getTrackInfo(
    { artist, title }: Pick<TrackInfo, "title" | "artist">,
    apiKey: string,
    verbose: boolean
): Promise<LastFmTrack | null> {
    try {
        const data = await requestLastFm<LastFmInfoResponse>(
            {
                method: "track.getInfo",
                artist,
                track: title,
                api_key: apiKey,
                format: "json",
                autocorrect: "1",
            },
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

    return artist?.name ?? "";
}

function removeArtistPrefix(title: string, artist: string): string {
    if (
        !artist ||
        title.slice(0, artist.length).toLowerCase() !== artist.toLowerCase()
    ) {
        return title;
    }

    const remainder = title.slice(artist.length);
    const separator = remainder.match(/^\s*[-–—:]\s*/);

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
