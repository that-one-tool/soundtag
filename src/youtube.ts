import { getErrorMessage } from "./errors.js";
import { downloadImage, fetchWithTimeout, readJsonResponse } from "./http.js";
import type { CoverProvider, TrackSearch } from "./types.js";

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

interface YouTubeThumbnail {
    url?: string;
}

interface YouTubeSearchItem {
    snippet?: {
        thumbnails?: {
            maxres?: YouTubeThumbnail;
            standard?: YouTubeThumbnail;
            high?: YouTubeThumbnail;
            medium?: YouTubeThumbnail;
            default?: YouTubeThumbnail;
        };
    };
}

interface YouTubeSearchResponse {
    items?: YouTubeSearchItem[];
}

async function findThumbnailUrl(
    title: string,
    artist: string,
    apiKey: string
): Promise<string | null> {
    const url = new URL(YOUTUBE_SEARCH_URL);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "1");
    url.searchParams.set("q", [artist, title].filter(Boolean).join(" "));
    url.searchParams.set("key", apiKey);

    try {
        const data = await readJsonResponse<YouTubeSearchResponse>(
            await fetchWithTimeout(url),
            "YouTube Data API"
        );
        const thumbnails = data.items?.[0]?.snippet?.thumbnails;

        return (
            thumbnails?.maxres?.url ??
            thumbnails?.standard?.url ??
            thumbnails?.high?.url ??
            thumbnails?.medium?.url ??
            thumbnails?.default?.url ??
            null
        );
    } catch (error) {
        console.error(
            `YouTube thumbnail search failed: ${getErrorMessage(error)}`
        );
        return null;
    }
}

async function downloadThumbnail(url: string): Promise<Buffer | null> {
    try {
        return await downloadImage({ url });
    } catch (error) {
        console.error(
            `YouTube thumbnail download failed: ${getErrorMessage(error)}`
        );
        return null;
    }
}

export class YouTubeCoverProvider implements CoverProvider {
    constructor(private readonly apiKey: string) {}

    async findCover(search: TrackSearch): Promise<Buffer | null> {
        const thumbnailUrl = await findThumbnailUrl(
            search.title,
            search.artist,
            this.apiKey
        );
        return thumbnailUrl ? downloadThumbnail(thumbnailUrl) : null;
    }
}
