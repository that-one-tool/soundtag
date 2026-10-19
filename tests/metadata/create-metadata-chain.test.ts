import { consoleLogger } from "../../src/shared/logger.js";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createMetadataChain } from "../../src/metadata/create-metadata-chain.js";
import { ItunesProvider } from "../../src/metadata/providers/itunes.js";
import { LastFmProvider } from "../../src/metadata/providers/lastfm.js";
import { MusicBrainzProvider } from "../../src/metadata/providers/musicbrainz.js";
import { YouTubeCoverProvider } from "../../src/metadata/providers/youtube.js";
import { instantClock } from "../helpers/clock.js";
import { createRecordingLogger } from "../helpers/logger.js";

const originalConsoleError = console.error;
const originalFetch = globalThis.fetch;

afterEach(() => {
    console.error = originalConsoleError;
});

test("createMetadataChain orders every configured provider", () => {
    const chain = createMetadataChain(
        {
            lastFmApiKey: "key",
            verbose: false,
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
            youtubeApiKey: "youtube-key",
        },
        instantClock,
        consoleLogger
    );

    assert.deepEqual(
        chain.providers.map((provider) => provider.constructor),
        [LastFmProvider, MusicBrainzProvider, ItunesProvider]
    );
    assert.ok(chain.coverProvider instanceof YouTubeCoverProvider);
});

test("createMetadataChain warns and skips unconfigured optional providers", () => {
    const errors: string[] = [];
    console.error = (message: string) => errors.push(message);

    const chain = createMetadataChain(
        {
            lastFmApiKey: "key",
            verbose: false,
            musicBrainzUserAgent: " ",
            youtubeApiKey: " ",
        },
        instantClock,
        consoleLogger
    );

    assert.deepEqual(
        chain.providers.map((provider) => provider.constructor),
        [LastFmProvider, ItunesProvider]
    );
    assert.equal(chain.coverProvider, undefined);
    assert.deepEqual(errors, [
        "MusicBrainz fallback requires MUSICBRAINZ_USER_AGENT.",
    ]);
});

test("createMetadataChain gives the injected logger to the chain and providers", async () => {
    const logger = createRecordingLogger();
    const chain = createMetadataChain(
        { lastFmApiKey: "key", verbose: false, musicBrainzUserAgent: " " },
        instantClock,
        logger
    );
    globalThis.fetch = async () => new Response(null, { status: 500 });

    try {
        await chain.find(
            { title: "Title", artist: "Artist", album: "" },
            { title: "", artist: "", album: "", year: "" }
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(logger.errors, [
        "MusicBrainz fallback requires MUSICBRAINZ_USER_AGENT.",
        "Last.fm search failed: Last.fm request failed: HTTP 500",
        "iTunes Search failed: iTunes Search request failed: HTTP 500",
    ]);
});
