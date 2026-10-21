export const DEEZER_COVER_XL = "https://cdn.deezer.test/1000x1000.jpg";

// Answers API paths from `responses` and serves any other host as an image.
export function mockDeezer(
    responses: Record<string, unknown>,
    requested: string[] = []
): string[] {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requested.push(`${url.pathname}${url.search}`);

        if (url.hostname !== "api.deezer.com") {
            return new Response(`image ${url.pathname}`, {
                headers: { "content-type": "image/jpeg" },
            });
        }

        return Response.json(responses[url.pathname] ?? { data: [] });
    };
    return requested;
}

// For chain tests about other services: Deezer finds nothing.
export function withoutDeezerMatches(handler: typeof fetch): typeof fetch {
    return async (input, init) => {
        const url = new URL(input.toString());
        return url.hostname === "api.deezer.com"
            ? Response.json({ data: [] })
            : handler(input, init);
    };
}
