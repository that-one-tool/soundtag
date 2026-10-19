import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { ItunesProvider } from "../src/itunes.js";

const originalFetch = globalThis.fetch;
const instantClock = { now: () => 0, sleep: async () => undefined };

afterEach(() => {
    globalThis.fetch = originalFetch;
});

test("ItunesProvider skips the artwork download when no cover is needed", async () => {
    const requestedHosts: string[] = [];
    globalThis.fetch = async (input) => {
        requestedHosts.push(new URL(input.toString()).hostname);
        return Response.json({
            results: [
                {
                    trackName: "Title",
                    artworkUrl100: "https://artwork.test/cover.jpg",
                },
            ],
        });
    };

    const metadata = await new ItunesProvider(instantClock).findMetadata(
        { title: "Title", artist: "", album: "" },
        false
    );

    assert.equal(metadata?.info.title, "Title");
    assert.equal(metadata?.coverData, null);
    assert.deepEqual(requestedHosts, ["itunes.apple.com"]);
});
