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
