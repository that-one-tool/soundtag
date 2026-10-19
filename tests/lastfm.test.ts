import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { LastFmProvider } from "../src/lastfm.js";

const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const search = { title: "Title", artist: "Artist", album: "" };
let output: string[] = [];

beforeEach(() => {
    output = [];
    console.log = (message: string) => output.push(message);
});

afterEach(() => {
    globalThis.fetch = originalFetch;
    console.log = originalConsoleLog;
});

function mockLastFmMatchWithCover(requestedHosts: string[]): void {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requestedHosts.push(url.hostname);

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: { trackmatches: { track: { name: "Title" } } },
            });
        }

        return Response.json({
            track: {
                album: {
                    title: "Album",
                    image: [
                        { size: "large", "#text": "https://images.test/a.jpg" },
                    ],
                },
            },
        });
    };
}

test("LastFmProvider skips the cover download when no cover is needed", async () => {
    const requestedHosts: string[] = [];
    mockLastFmMatchWithCover(requestedHosts);

    const metadata = await new LastFmProvider("key").findMetadata(
        search,
        false
    );

    assert.equal(metadata?.info.album, "Album");
    assert.equal(metadata?.coverData, null);
    assert.ok(!requestedHosts.includes("images.test"));
});

test("LastFmProvider logs empty album details when nothing matches", async () => {
    globalThis.fetch = async () =>
        Response.json({ results: { trackmatches: { track: [] } } });

    assert.equal(
        await new LastFmProvider("key").findMetadata(search, true),
        null
    );
    assert.deepEqual(output, ["Album: ", "Year: "]);
});

test("LastFmProvider reads the first match from a result list with a plain artist", async () => {
    const requests: URL[] = [];
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requests.push(url);

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: {
                    trackmatches: {
                        track: [
                            {
                                name: "Plain Artist: Song",
                                artist: "Plain Artist",
                            },
                            { name: "Other", artist: "Other artist" },
                        ],
                    },
                },
            });
        }

        return Response.json({
            track: { album: { title: "Album", year: "1999" } },
        });
    };

    const metadata = await new LastFmProvider("key").findMetadata(
        { title: "Song", artist: "", album: "" },
        false
    );

    assert.deepEqual(metadata?.info, {
        title: "Song",
        artist: "Plain Artist",
        album: "Album",
        year: "1999",
    });
    assert.equal(requests[0].searchParams.has("artist"), false);
    assert.equal(requests[1].searchParams.get("track"), "Song");
    assert.equal(requests[1].searchParams.get("autocorrect"), "1");
});

test("LastFmProvider keeps titles that only start like the artist name", async () => {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: {
                    trackmatches: {
                        track: { name: "Abbaesque", artist: "Abba" },
                    },
                },
            });
        }

        return Response.json({});
    };

    const metadata = await new LastFmProvider("key").findMetadata(
        { title: "Abbaesque", artist: "Abba", album: "" },
        false
    );

    assert.equal(metadata?.info.title, "Abbaesque");
});

test("LastFmProvider removes a repeated artist prefix regardless of case", async () => {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: {
                    trackmatches: {
                        track: { name: "ABBA - Waterloo", artist: "Abba" },
                    },
                },
            });
        }

        return Response.json({});
    };

    const metadata = await new LastFmProvider("key").findMetadata(
        { title: "Waterloo", artist: "Abba", album: "" },
        false
    );

    assert.equal(metadata?.info.title, "Waterloo");
});
