import assert from "node:assert/strict";
import { test } from "node:test";
import { ItunesProvider } from "../../../src/metadata/providers/itunes.js";
import { instantClock } from "../../helpers/clock.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import type { Clock } from "../../../src/shared/rate-limiter.js";

restoreFetchAfterEach();

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

test("iTunes searches are rate-limited when requests run concurrently", async () => {
    let requestCount = 0;
    const sleeps: number[] = [];
    const clock: Clock = {
        now: () => 0,
        sleep: async (milliseconds) => sleeps.push(milliseconds),
    };
    globalThis.fetch = async (input) => {
        assert.equal(new URL(input.toString()).hostname, "itunes.apple.com");
        requestCount++;
        return Response.json({ results: [] });
    };
    const provider = new ItunesProvider(clock);
    const search = { title: "title", artist: "artist", album: "" };

    await Promise.all([
        provider.findMetadata(search, true),
        provider.findMetadata(search, true),
    ]);

    assert.equal(requestCount, 2);
    assert.deepEqual(sleeps, [3000]);
});
