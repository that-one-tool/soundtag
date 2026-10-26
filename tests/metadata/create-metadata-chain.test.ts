import { consoleLogger } from "../../src/shared/logger.js";
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createMetadataLookups } from "../../src/metadata/create-metadata-chain.js";
import { DeezerAlbumSource } from "../../src/metadata/providers/deezer-album.js";
import { DiscogsAlbumSource } from "../../src/metadata/providers/discogs-album.js";
import { MusicBrainzAlbumSource } from "../../src/metadata/providers/musicbrainz-album.js";
import { DeezerCoverProvider } from "../../src/metadata/providers/deezer-cover.js";
import { DeezerProvider } from "../../src/metadata/providers/deezer.js";
import {
    DiscogsAlbumProvider,
    DiscogsProvider,
} from "../../src/metadata/providers/discogs.js";
import { ListenBrainzProvider } from "../../src/metadata/providers/listenbrainz.js";
import { ItunesProvider } from "../../src/metadata/providers/itunes.js";
import { LastFmProvider } from "../../src/metadata/providers/lastfm.js";
import { MusicBrainzProvider } from "../../src/metadata/providers/musicbrainz.js";
import { YouTubeCoverProvider } from "../../src/metadata/providers/youtube.js";
import { instantClock } from "../helpers/clock.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { emptyTags } from "../helpers/metadata-chain.js";

const originalConsoleError = console.error;
const originalFetch = globalThis.fetch;

afterEach(() => {
    console.error = originalConsoleError;
});

test("createMetadataLookups orders every configured provider", () => {
    const { chain, albums } = createMetadataLookups(
        {
            lastFmApiKey: "key",
            verbose: false,
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
            youtubeApiKey: "youtube-key",
            listenBrainzToken: "token",
            discogsConsumerKey: "discogs-key",
            discogsConsumerSecret: "discogs-secret",
        },
        instantClock,
        consoleLogger
    );

    assert.deepEqual(
        chain.providers.map((provider) => provider.constructor),
        [
            DiscogsAlbumProvider,
            ListenBrainzProvider,
            MusicBrainzProvider,
            DeezerProvider,
            DiscogsProvider,
            ItunesProvider,
            LastFmProvider,
        ]
    );
    assert.deepEqual(
        chain.coverProviders.map((provider) => provider.constructor),
        [DeezerCoverProvider, YouTubeCoverProvider]
    );
    assert.deepEqual(
        albums.sources.map((source) => source.constructor),
        [MusicBrainzAlbumSource, DeezerAlbumSource, DiscogsAlbumSource]
    );
    assert.equal(albums.coverSources[0], albums.sources[1]);
    assert.equal(albums.coverSources.length, 1);
});

test("createMetadataLookups warns and skips unconfigured optional providers", () => {
    const logger = createRecordingLogger();

    const { chain, albums } = createMetadataLookups(
        {
            lastFmApiKey: " ",
            verbose: false,
            musicBrainzUserAgent: " ",
            youtubeApiKey: " ",
            listenBrainzToken: " ",
            discogsConsumerKey: "key",
            discogsConsumerSecret: " ",
        },
        instantClock,
        logger
    );

    assert.deepEqual(
        chain.providers.map((provider) => provider.constructor),
        [DeezerProvider, ItunesProvider]
    );
    assert.deepEqual(
        chain.coverProviders.map((provider) => provider.constructor),
        [DeezerCoverProvider]
    );
    assert.deepEqual(
        albums.sources.map((source) => source.constructor),
        [DeezerAlbumSource]
    );
    assert.deepEqual(logger.errors, [
        "MusicBrainz and ListenBrainz require MUSICBRAINZ_USER_AGENT.",
    ]);
    assert.deepEqual(logger.infos, [
        "ListenBrainz lookup requires LISTENBRAINZ_TOKEN.",
        "Last.fm lookup requires LASTFM_API_KEY.",
        "Discogs lookup requires DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET.",
    ]);
});

test("createMetadataLookups skips ListenBrainz without a MusicBrainz User-Agent", () => {
    const { chain } = createMetadataLookups(
        { verbose: false, listenBrainzToken: "token" },
        instantClock,
        createRecordingLogger()
    );

    assert.deepEqual(
        chain.providers.map((provider) => provider.constructor),
        [DeezerProvider, ItunesProvider]
    );
});

test("createMetadataLookups gives the injected logger to the chain and providers", async () => {
    const logger = createRecordingLogger();
    const { chain } = createMetadataLookups(
        { lastFmApiKey: "key", verbose: false, musicBrainzUserAgent: " " },
        instantClock,
        logger
    );
    globalThis.fetch = async () => new Response(null, { status: 500 });

    try {
        await chain.lookups.step({ label: "search" }, () =>
            chain.find(
                { title: "Title", artist: "Artist", album: "" },
                emptyTags
            )
        );
    } finally {
        globalThis.fetch = originalFetch;
    }

    assert.deepEqual(logger.errors, [
        "MusicBrainz and ListenBrainz require MUSICBRAINZ_USER_AGENT.",
    ]);
    assert.equal(
        logger.infos.at(-1),
        "  search Deezer ✗ HTTP 500 0.0s · iTunes ✗ HTTP 500 0.0s · Last.fm ✗ HTTP 500 0.0s"
    );
});

test("createMetadataLookups corrects tags from ListenBrainz and MusicBrainz", () => {
    const configured = createMetadataLookups(
        {
            verbose: false,
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
        },
        instantClock,
        createRecordingLogger()
    );
    const unconfigured = createMetadataLookups(
        { verbose: false },
        instantClock,
        createRecordingLogger()
    );

    assert.equal(configured.corrector.canCorrect(), true);
    assert.equal(unconfigured.corrector.canCorrect(), false);
});
