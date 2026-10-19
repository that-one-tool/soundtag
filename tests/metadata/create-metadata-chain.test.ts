import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createMetadataChain } from "../../src/metadata/create-metadata-chain.js";
import { ItunesProvider } from "../../src/metadata/providers/itunes.js";
import { LastFmProvider } from "../../src/metadata/providers/lastfm.js";
import { MusicBrainzProvider } from "../../src/metadata/providers/musicbrainz.js";
import { YouTubeCoverProvider } from "../../src/metadata/providers/youtube.js";

const originalConsoleError = console.error;

afterEach(() => {
    console.error = originalConsoleError;
});

test("createMetadataChain orders every configured provider", () => {
    const chain = createMetadataChain({
        lastFmApiKey: "key",
        verbose: false,
        musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
        youtubeApiKey: "youtube-key",
    });

    assert.deepEqual(
        chain.providers.map((provider) => provider.constructor),
        [LastFmProvider, MusicBrainzProvider, ItunesProvider]
    );
    assert.ok(chain.coverProvider instanceof YouTubeCoverProvider);
});

test("createMetadataChain warns and skips unconfigured optional providers", () => {
    const errors: string[] = [];
    console.error = (message: string) => errors.push(message);

    const chain = createMetadataChain({
        lastFmApiKey: "key",
        verbose: false,
        musicBrainzUserAgent: " ",
        youtubeApiKey: " ",
    });

    assert.deepEqual(
        chain.providers.map((provider) => provider.constructor),
        [LastFmProvider, ItunesProvider]
    );
    assert.equal(chain.coverProvider, undefined);
    assert.deepEqual(errors, [
        "MusicBrainz fallback requires MUSICBRAINZ_USER_AGENT.",
    ]);
});
