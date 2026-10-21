import { fetchWithTimeout, readJsonResponse } from "../../shared/http.js";
import type { CoverProvider, ProviderServices, TrackSearch } from "../types.js";

const YOUTUBE_SEARCH_URL = "https://www.googleapis.com/youtube/v3/search";

interface YouTubeThumbnail {
    url?: string;
}

interface YouTubeThumbnails {
    maxres?: YouTubeThumbnail;
    standard?: YouTubeThumbnail;
    high?: YouTubeThumbnail;
    medium?: YouTubeThumbnail;
    default?: YouTubeThumbnail;
}

interface YouTubeSnippet {
    thumbnails?: YouTubeThumbnails;
}

interface YouTubeSearchItem {
    snippet?: YouTubeSnippet;
}

interface YouTubeSearchResponse {
    items?: YouTubeSearchItem[];
}

const THUMBNAIL_SIZES = [
    "maxres",
    "standard",
    "high",
    "medium",
    "default",
] as const;

function buildYouTubeSearchUrl(
    { title, artist }: TrackSearch,
    apiKey: string
): URL {
    const url = new URL(YOUTUBE_SEARCH_URL);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("maxResults", "1");
    url.searchParams.set("q", [artist, title].filter(Boolean).join(" "));
    url.searchParams.set("key", apiKey);
    return url;
}

function getFirstSnippet(
    data: YouTubeSearchResponse
): YouTubeSnippet | undefined {
    return data.items?.[0]?.snippet;
}

function getThumbnails(data: YouTubeSearchResponse): YouTubeThumbnails {
    return getFirstSnippet(data)?.thumbnails ?? {};
}

function getBestThumbnailUrl(data: YouTubeSearchResponse): string | null {
    const thumbnails = getThumbnails(data);
    const urls = THUMBNAIL_SIZES.map((size) => thumbnails[size]?.url);
    return urls.find(Boolean) ?? null;
}

async function findThumbnailUrl(
    search: TrackSearch,
    apiKey: string,
    { lookups }: ProviderServices
): Promise<string | null> {
    const url = buildYouTubeSearchUrl(search, apiKey);
    lookups.request(url);
    const data = await readJsonResponse<YouTubeSearchResponse>(
        await fetchWithTimeout(url),
        "YouTube Data API"
    );
    return getBestThumbnailUrl(data);
}

export class YouTubeCoverProvider implements CoverProvider {
    readonly name = "YouTube";

    constructor(
        private readonly apiKey: string,
        private readonly services: ProviderServices
    ) {}

    async findCover(search: TrackSearch): Promise<Buffer | null> {
        const thumbnailUrl = await findThumbnailUrl(
            search,
            this.apiKey,
            this.services
        );
        return thumbnailUrl
            ? this.services.images.download({ url: thumbnailUrl })
            : null;
    }
}
