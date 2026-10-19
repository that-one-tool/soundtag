import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { afterEach, test } from "node:test";
import { searchMusicBrainz } from "../src/musicbrainz.js";

const originalFetch = globalThis.fetch;
const userAgent = "SoundTag/1.0 (test@example.com)";

afterEach(() => {
    globalThis.fetch = originalFetch;
});

function mockMusicBrainzResponses(responses: (() => Response)[]): {
    count: () => number;
    times: number[];
    bodies: Response[];
} {
    const times: number[] = [];
    const bodies: Response[] = [];
    globalThis.fetch = async () => {
        times.push(performance.now());
        const response = responses[times.length - 1]();
        bodies.push(response);
        return response;
    };
    return { count: () => times.length, times, bodies };
}

const unavailable = () =>
    new Response("busy", { status: 503, headers: { "retry-after": "0" } });
const recording = () =>
    Response.json({ recordings: [{ title: "Retried title" }] });

test("searchMusicBrainz retries once when the service is unavailable", async () => {
    const requests = mockMusicBrainzResponses([unavailable, recording]);

    const result = await searchMusicBrainz("Title", "Artist", userAgent);

    assert.equal(result?.title, "Retried title");
    assert.equal(requests.count(), 2);
    assert.ok(
        requests.times[1] - requests.times[0] >= 900,
        "the retry must go through the MusicBrainz rate limiter"
    );
    assert.equal(requests.bodies[0].bodyUsed, true);
});

test("searchMusicBrainz gives up after a second unavailable response", async () => {
    const requests = mockMusicBrainzResponses([
        unavailable,
        unavailable,
        recording,
    ]);
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
        assert.equal(
            await searchMusicBrainz("Title", "Artist", userAgent),
            null
        );
    } finally {
        console.error = originalConsoleError;
    }
    assert.equal(requests.count(), 2);
});

test("searchMusicBrainz does not retry other HTTP errors", async () => {
    const requests = mockMusicBrainzResponses([
        () => new Response(null, { status: 500 }),
        recording,
    ]);
    const originalConsoleError = console.error;
    console.error = () => {};

    try {
        assert.equal(
            await searchMusicBrainz("Title", "Artist", userAgent),
            null
        );
    } finally {
        console.error = originalConsoleError;
    }
    assert.equal(requests.count(), 1);
});
