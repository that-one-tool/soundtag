import { ignoreServiceError } from "../../shared/errors.js";
import type { ImageCache } from "../../shared/image-cache.js";
import type { LookupLog } from "../../shared/lookup-log.js";
import {
    fetchWithTimeout,
    readJsonResponse,
    type ImageRequest,
} from "../../shared/http.js";
import {
    createRateLimiter,
    type RateLimiter,
} from "../../shared/rate-limiter.js";
import { isSameTrack } from "../track-matching.js";
import { extractYear, valueOrEmpty } from "../track-metadata.js";
import type {
    MetadataProvider,
    ProviderNeeds,
    ProviderServices,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../types.js";

const LASTFM_BASE = "https://ws.audioscrobbler.com/2.0/";
const DEFAULT_COVER = "2a96cbd8b46e442fc41c2b86b821562f.png";
const MAX_LARGE_COVER_BYTES = 500 * 1024;
const LASTFM_REQUEST_INTERVAL = 2_000;

export interface LastFmSettings {
    apiKey: string;
}

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

type MatchedTrack = Pick<TrackInfo, "title" | "artist">;

interface DirectLookup {
    asked: MatchedTrack | null;
    track: LastFmTrack | null;
}

const NO_DIRECT_LOOKUP: DirectLookup = { asked: null, track: null };

interface LastFmMatch {
    matched: MatchedTrack;
    album?: LastFmAlbum;
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

async function requestLastFm<T>(
    params: Record<string, string>,
    lookups: LookupLog
): Promise<T> {
    const url = buildLastFmUrl(params);
    lookups.request(url);
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

function buildTrackInfoParams(
    { artist, title }: MatchedTrack,
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
): MatchedTrack {
    const artist = getArtistName(match.artist) || search.artist;
    return {
        artist,
        title: removeArtistPrefix(match.name || search.title, artist),
    };
}

// A scrobbled variant without an album is a worse match than what search finds.
function isAlbumTrack(track: LastFmTrack): boolean {
    return Boolean(track.name && track.album?.title);
}

function getAlbumTrack({ track }: DirectLookup): LastFmTrack | null {
    return track && isAlbumTrack(track) ? track : null;
}

function isSearchedSong(matched: MatchedTrack, search: TrackSearch): boolean {
    const prefix = search.artist || matched.artist;
    const title = removeArtistPrefix(search.title, prefix);
    return isSameTrack(matched, { ...search, title });
}

function getSearchedSong(
    track: LastFmTrack | null,
    search: TrackSearch
): LastFmMatch | null {
    if (!track) {
        return null;
    }

    const matched = getMatchedTrack(track, search);
    return isSearchedSong(matched, search)
        ? { matched, album: track.album }
        : null;
}

// Asking track.getInfo again would return the same other song.
function getSongTrack(
    track: LastFmTrack | null,
    search: TrackSearch
): LastFmTrack | null {
    return getSearchedSong(track, search) ? track : null;
}

function isAskedTrack(asked: MatchedTrack | null, matched: MatchedTrack) {
    return asked?.title === matched.title && asked.artist === matched.artist;
}

function getAlbumYear(album: LastFmAlbum): string {
    return album.year ?? extractYear(album.date);
}

function getAlbumInfo(
    matched: MatchedTrack,
    album: LastFmAlbum = {}
): TrackInfo {
    return {
        ...matched,
        album: album.title ?? "",
        year: getAlbumYear(album),
    };
}

function downloadAlbumCover(
    images: ImageCache,
    album: LastFmAlbum = {}
): Promise<Buffer | null> {
    return images.downloadFirst(
        getCoverImageRequests(getCoverImages(album.image))
    );
}

export class LastFmProvider implements MetadataProvider {
    readonly name = "Last.fm";
    private readonly schedule: RateLimiter;

    constructor(
        private readonly settings: LastFmSettings,
        private readonly services: ProviderServices
    ) {
        this.schedule = createRateLimiter(
            LASTFM_REQUEST_INTERVAL,
            services.clock,
            services.lookups.noteWait
        );
    }

    async findMetadata(
        search: TrackSearch,
        { cover: needsCover }: ProviderNeeds
    ): Promise<TrackMetadata | null> {
        const match = await this.findMatch(search);

        return match && this.getMatchMetadata(match, needsCover);
    }

    private async findMatch(search: TrackSearch): Promise<LastFmMatch | null> {
        const direct = await this.lookUpDirectly(search);
        return (
            getSearchedSong(getAlbumTrack(direct), search) ??
            this.searchThenGetInfo(search, direct)
        );
    }

    // Saves the track.search request, which halves the Last.fm time per track.
    private async lookUpDirectly(search: TrackSearch): Promise<DirectLookup> {
        if (!search.artist) {
            return NO_DIRECT_LOOKUP;
        }

        const asked = {
            artist: search.artist,
            title: removeArtistPrefix(search.title, search.artist),
        };
        // A miss falls back to track.search, so it needs no note.
        const track =
            await this.requestTrackInfo(asked).catch(ignoreServiceError);
        return { asked, track: getSongTrack(track, search) };
    }

    private async searchThenGetInfo(
        search: TrackSearch,
        direct: DirectLookup
    ): Promise<LastFmMatch | null> {
        const found = getSearchedSong(await this.searchTrack(search), search);

        if (!found) {
            return null;
        }

        const track = await this.getTrackInfoOnce(found.matched, direct);
        return { matched: found.matched, album: track?.album };
    }

    private getTrackInfoOnce(
        matched: MatchedTrack,
        direct: DirectLookup
    ): Promise<LastFmTrack | null> {
        return isAskedTrack(direct.asked, matched)
            ? Promise.resolve(direct.track)
            : this.getTrackInfo(matched);
    }

    private async getMatchMetadata(
        { matched, album }: LastFmMatch,
        needsCover: boolean
    ): Promise<TrackMetadata> {
        const info = getAlbumInfo(matched, album);
        const coverData = needsCover
            ? await downloadAlbumCover(this.services.images, album)
            : null;
        return { info, extras: {}, coverData };
    }

    private request<T>(params: Record<string, string>): Promise<T> {
        return this.schedule(() =>
            requestLastFm<T>(params, this.services.lookups)
        );
    }

    private async searchTrack({
        title,
        artist,
    }: TrackSearch): Promise<LastFmTrack | null> {
        const data = await this.request<LastFmSearchResponse>(
            buildSearchParams(title, this.settings.apiKey, artist)
        );
        return getFirstMatch(data);
    }

    private async requestTrackInfo(
        matched: MatchedTrack
    ): Promise<LastFmTrack | null> {
        const data = await this.request<LastFmInfoResponse>(
            buildTrackInfoParams(matched, this.settings.apiKey)
        );
        return data.track ?? null;
    }

    private async getTrackInfo(
        matched: MatchedTrack
    ): Promise<LastFmTrack | null> {
        try {
            return await this.requestTrackInfo(matched);
        } catch (error) {
            this.services.lookups.noteFailure("track info", error);
            return null;
        }
    }
}
