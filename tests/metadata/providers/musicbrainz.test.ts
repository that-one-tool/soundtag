import { consoleLogger } from "../../../src/shared/logger.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { MusicBrainzProvider } from "../../../src/metadata/providers/musicbrainz.js";
import { createFakeClock } from "../../helpers/clock.js";
import { captureConsole } from "../../helpers/console.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createRecordingLogger } from "../../helpers/logger.js";

restoreFetchAfterEach();
captureConsole();
const userAgent = "SoundTag/1.0 (test@example.com)";
const search = { title: "Title", artist: "Artist", album: "" };

function mockMusicBrainzResponses(responses: (() => Response)[]): Response[] {
    const sent: Response[] = [];
    globalThis.fetch = async () => {
        const response = responses[sent.length]();
        sent.push(response);
        return response;
    };
    return sent;
}

function unavailable(retryAfter: string): () => Response {
    return () =>
        new Response("busy", {
            status: 503,
            headers: { "retry-after": retryAfter },
        });
}

const recording = () =>
    Response.json({ recordings: [{ title: "Retried title" }] });

test("MusicBrainzProvider retries once after the Retry-After delay", async () => {
    const clock = createFakeClock();
    const sent = mockMusicBrainzResponses([unavailable("3"), recording]);

    const metadata = await new MusicBrainzProvider(
        userAgent,
        clock,
        consoleLogger
    ).findMetadata(search, false);

    assert.equal(metadata?.info.title, "Retried title");
    assert.equal(sent.length, 2);
    assert.equal(sent[0].bodyUsed, true);
    assert.deepEqual(clock.sleeps, [3000]);
});

test("MusicBrainzProvider rate-limits the retry", async () => {
    const clock = createFakeClock();
    mockMusicBrainzResponses([unavailable("0"), recording]);

    await new MusicBrainzProvider(userAgent, clock, consoleLogger).findMetadata(
        search,
        false
    );

    assert.deepEqual(clock.sleeps, [0, 2000]);
});

test("MusicBrainzProvider gives up after a second unavailable response", async () => {
    const sent = mockMusicBrainzResponses([
        unavailable("0"),
        unavailable("0"),
        recording,
    ]);

    assert.equal(
        await new MusicBrainzProvider(
            userAgent,
            createFakeClock(),
            consoleLogger
        ).findMetadata(search, false),
        null
    );
    assert.equal(sent.length, 2);
});

test("MusicBrainzProvider does not retry other HTTP errors", async () => {
    const sent = mockMusicBrainzResponses([
        () => new Response(null, { status: 500 }),
        recording,
    ]);

    assert.equal(
        await new MusicBrainzProvider(
            userAgent,
            createFakeClock(),
            consoleLogger
        ).findMetadata(search, false),
        null
    );
    assert.equal(sent.length, 1);
});

test("MusicBrainzProvider skips the cover download when no cover is needed", async () => {
    const sent = mockMusicBrainzResponses([
        () =>
            Response.json({
                recordings: [{ title: "Title", releases: [{ id: "release" }] }],
            }),
    ]);

    const metadata = await new MusicBrainzProvider(
        userAgent,
        createFakeClock(),
        consoleLogger
    ).findMetadata(search, false);

    assert.equal(metadata?.coverData, null);
    assert.equal(sent.length, 1);
});

test("MusicBrainzProvider logs failures to the injected logger", async () => {
    const logger = createRecordingLogger();
    mockMusicBrainzResponses([() => new Response(null, { status: 500 })]);

    await new MusicBrainzProvider(
        userAgent,
        createFakeClock(),
        logger
    ).findMetadata(search, false);

    assert.deepEqual(logger.errors, [
        "MusicBrainz search failed: MusicBrainz request failed: HTTP 500",
    ]);
});
