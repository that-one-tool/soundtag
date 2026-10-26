export const DISCOGS_COVER = "https://i.discogs.test/cover.jpg";

export interface DiscogsRequest {
    url: URL;
    headers: Headers;
}

// Answers API paths from `responses` and serves any other host as an image.
export function mockDiscogs(
    responses: Record<string, unknown>,
    requested: DiscogsRequest[] = []
): DiscogsRequest[] {
    globalThis.fetch = async (input, init) => {
        const url = new URL(input.toString());
        requested.push({ url, headers: new Headers(init?.headers) });

        if (url.hostname !== "api.discogs.com") {
            return new Response(`image ${url.pathname}`, {
                headers: { "content-type": "image/jpeg" },
            });
        }

        return Response.json(responses[url.pathname] ?? { results: [] });
    };
    return requested;
}
