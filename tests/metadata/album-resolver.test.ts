import assert from "node:assert/strict";
import { test } from "node:test";
import { AlbumResolver } from "../../src/metadata/album-resolver.js";
import { ServiceError } from "../../src/shared/errors.js";
import type {
    AlbumSearch,
    AlbumSource,
    FoundAlbum,
} from "../../src/metadata/types.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { createProviderServices } from "../helpers/metadata-chain.js";

restoreFetchAfterEach();

const search = { artist: "Queen", album: "jazz" };
const tracks = [
    {
        title: "Mustapha",
        trackNumber: 1,
        trackCount: 13,
        discNumber: 1,
        discCount: 1,
    },
];

class FakeAlbumSource implements AlbumSource {
    readonly searches: AlbumSearch[] = [];

    constructor(
        readonly name: string,
        private readonly found: FoundAlbum | null | Error
    ) {}

    async findAlbum(albumSearch: AlbumSearch): Promise<FoundAlbum | null> {
        this.searches.push(albumSearch);
        if (this.found instanceof Error) {
            throw this.found;
        }
        return this.found;
    }
}

function coverOf(name: string) {
    return [{ url: new URL(`https://covers.test/${name}.jpg`) }];
}

function mockImages(missing: string[] = []): void {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        return missing.includes(url.pathname)
            ? new Response(null, { status: 404 })
            : new Response(`image ${url.pathname}`, {
                  headers: { "content-type": "image/jpeg" },
              });
    };
}

function createSources() {
    const deezer = new FakeAlbumSource("Deezer", {
        album: "Jazz",
        artist: "Queen",
        year: "2011",
        genre: "Rock",
        covers: coverOf("deezer"),
    });
    const musicBrainz = new FakeAlbumSource("MusicBrainz", {
        album: "Jazz",
        artist: "Queen",
        year: "1978",
        covers: coverOf("musicbrainz"),
    });
    const discogs = new FakeAlbumSource("Discogs", {
        album: "JAZZ",
        artist: "Queen",
        genre: "Pop",
        covers: [],
        tracks,
    });
    return { deezer, musicBrainz, discogs };
}

function createResolver(sources = createSources()) {
    const { deezer, musicBrainz, discogs } = sources;
    const logger = createRecordingLogger();
    const resolver = new AlbumResolver(
        {
            identity: [deezer, musicBrainz, discogs],
            year: [discogs, musicBrainz, deezer],
            genre: [deezer, discogs],
            tracks: [discogs, deezer],
            cover: [deezer, musicBrainz, discogs],
        },
        createProviderServices({ logger })
    );
    return { resolver, logger, ...sources };
}

test("AlbumResolver takes each field from the first source that has it", async () => {
    mockImages();
    const { resolver } = createResolver();

    const album = await resolver.resolve(search);

    assert.deepEqual(
        { ...album, cover: album.cover?.toString() },
        {
            album: "Jazz",
            artist: "Queen",
            year: "1978",
            genre: "Rock",
            cover: "image /deezer.jpg",
            tracks,
            found: true,
        }
    );
});

test("AlbumResolver asks each source once and only while a field needs it", async () => {
    mockImages();
    const sources = createSources();
    const discogs = new FakeAlbumSource("Discogs", {
        album: "Jazz",
        artist: "Queen",
        year: "1978",
        covers: [],
        tracks,
    });
    const { resolver, deezer, musicBrainz } = createResolver({
        ...sources,
        discogs,
    });

    await resolver.resolve(search);

    assert.equal(deezer.searches.length, 1);
    assert.equal(discogs.searches.length, 1);
    assert.equal(musicBrainz.searches.length, 0);
});

test("AlbumResolver keeps an album for the batch, whatever its letter case", async () => {
    mockImages();
    const { resolver, deezer } = createResolver();

    const first = await resolver.resolve(search);
    const second = await resolver.resolve({ artist: "QUEEN", album: "Jazz" });

    assert.equal(second, first);
    assert.equal(deezer.searches.length, 1);
});

test("AlbumResolver takes the next cover when one cannot be downloaded", async () => {
    mockImages(["/deezer.jpg"]);
    const { resolver } = createResolver();

    const album = await resolver.resolve(search);

    assert.equal(album.cover?.toString(), "image /musicbrainz.jpg");
});

test("AlbumResolver goes on without a failing source and logs it", async () => {
    mockImages();
    const sources = createSources();
    const deezer = new FakeAlbumSource("Deezer", new ServiceError("down"));
    const { resolver, logger } = createResolver({ ...sources, deezer });

    const album = await resolver.resolve(search);

    assert.equal(album.album, "Jazz");
    assert.equal(album.genre, "Pop");
    assert.equal(album.cover?.toString(), "image /musicbrainz.jpg");
    assert.match(
        logger.infos.join("\n"),
        /album {2}"jazz" · Queen: Deezer ✗ down/
    );
});

test("AlbumResolver falls back to the folder names when no source has the album", async () => {
    const none = new FakeAlbumSource("None", null);
    const { resolver } = createResolver({
        deezer: none,
        musicBrainz: none,
        discogs: none,
    });

    assert.deepEqual(await resolver.resolve(search), {
        album: "jazz",
        artist: "Queen",
        year: "",
        genre: "",
        cover: null,
        tracks: [],
        found: false,
    });
});

test("AlbumResolver lets other errors through", async () => {
    const sources = createSources();
    const deezer = new FakeAlbumSource("Deezer", new TypeError("bug"));
    const { resolver } = createResolver({ ...sources, deezer });

    await assert.rejects(resolver.resolve(search), /bug/);
});

test("AlbumResolver skips an empty tracklist and leaves an unknown year empty", async () => {
    mockImages();
    const deezer = new FakeAlbumSource("Deezer", {
        album: "Jazz",
        artist: "Queen",
        covers: [],
        tracks,
    });
    const discogs = new FakeAlbumSource("Discogs", {
        album: "Jazz",
        artist: "Queen",
        covers: [],
        tracks: [],
    });
    const none = new FakeAlbumSource("MusicBrainz", null);
    const { resolver, logger } = createResolver({
        deezer,
        musicBrainz: none,
        discogs,
    });

    const album = await resolver.resolve(search);

    assert.deepEqual(album.tracks, tracks);
    assert.equal(album.year, "");
    assert.equal(album.cover, null);
    assert.match(logger.infos.join("\n"), /Deezer ✓ tracklist/);
});

test("AlbumResolver prefers the tracklist that fits the folder's file count", async () => {
    mockImages();
    const sources = createSources();
    const longer = [
        ...tracks,
        { ...tracks[0], title: "Bonus", trackNumber: 2 },
    ];
    const deezer = new FakeAlbumSource("Deezer", {
        album: "Jazz (2011 Remaster)",
        artist: "Queen",
        covers: [],
        tracks: longer,
    });
    const { resolver } = createResolver({ ...sources, deezer });

    const album = await resolver.resolve(search, 2);

    assert.equal(album.album, "Jazz");
    assert.deepEqual(album.tracks, longer);
    assert.equal(album.genre, "Pop");
});

test("AlbumResolver takes the first tracklist when none fits the folder", async () => {
    mockImages();
    const { resolver } = createResolver();

    assert.deepEqual((await resolver.resolve(search, 5)).tracks, tracks);
});
