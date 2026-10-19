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

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
        const response = await fetch(url, {
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            throw new Error(
                `YouTube Data API request failed: HTTP ${response.status}`
            );
        }

        const data = (await response.json()) as YouTubeSearchResponse;
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
        const response = await fetch(url, {
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            throw new Error(
                `YouTube thumbnail request failed: HTTP ${response.status}`
            );
        }

        const contentType = response.headers.get("content-type") ?? "";

        if (!contentType.toLowerCase().startsWith("image/")) {
            throw new Error("YouTube thumbnail response was not an image.");
        }

        const data = Buffer.from(await response.arrayBuffer());
        return data.length > 0 ? data : null;
    } catch (error) {
        console.error(
            `YouTube thumbnail download failed: ${getErrorMessage(error)}`
        );
        return null;
    }
}

export async function findYouTubeThumbnail(
    title: string,
    artist: string,
    apiKey: string
): Promise<Buffer | null> {
    const thumbnailUrl = await findThumbnailUrl(title, artist, apiKey);
    return thumbnailUrl ? downloadThumbnail(thumbnailUrl) : null;
}
