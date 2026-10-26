import assert from "node:assert/strict";
import { test } from "node:test";
import { DeezerAlbumSource } from "../../../src/metadata/providers/deezer-album.js";
import { DeezerClient } from "../../../src/metadata/providers/deezer-client.js";
import { DEEZER_COVER_XL, mockDeezer } from "../../helpers/deezer.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createRecordingLogger } from "../../helpers/logger.js";
import { createProviderServices } from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();

const search = { artist: "Daft Punk", album: "discovery" };

function findDeezerAlbum(albumSearch = search) {
    const services = createProviderServices();
    const client = new DeezerClient(services);
    return new DeezerAlbumSource(client, services).findAlbum(albumSearch);
}

test("DeezerAlbumSource gives the searched album as Deezer spells it", async () => {
    const requested = mockDeezer({
        "/search/album": {
            data: [
                { title: "Discovery", artist: { name: "Data Punk" } },
                {
                    title: "Discovery",
                    artist: { name: "Daft Punk" },
                    cover_xl: DEEZER_COVER_XL,
                },
            ],
        },
    });

    const found = await findDeezerAlbum();

    assert.equal(found?.album, "Discovery");
    assert.deepEqual(
        found?.covers.map(({ url }) => url.toString()),
        [DEEZER_COVER_XL]
    );
    assert.deepEqual(requested, [
        "/search/album?q=Daft+Punk+discovery&limit=5",
    ]);
});

test("DeezerAlbumSource finds nothing without the same album", async () => {
    mockDeezer({
        "/search/album": {
            data: [
                { title: "Discovery (Deluxe)", artist: { name: "Daft Punk" } },
                { artist: { name: "Daft Punk" } },
            ],
        },
    });

    assert.equal(await findDeezerAlbum(), null);
});

const acoustica = { artist: "Scorpions", album: "Acoustica" };

test("DeezerAlbumSource looks through the artist's albums when the album search misses", async () => {
    const requested = mockDeezer({
        "/search/artist": {
            data: [
                { id: 1, name: "Scorpions Tribute" },
                { id: 7, name: "Scorpions" },
            ],
        },
        "/artist/7/albums": {
            data: [
                { title: "MTV Unplugged" },
                { title: "Acoustica", cover_xl: DEEZER_COVER_XL },
            ],
        },
    });

    const found = await findDeezerAlbum(acoustica);

    assert.equal(found?.album, "Acoustica");
    assert.deepEqual(
        found?.covers.map(({ url }) => url.toString()),
        [DEEZER_COVER_XL]
    );
    assert.deepEqual(requested, [
        "/search/album?q=Scorpions+Acoustica&limit=5",
        "/search/artist?q=Scorpions&limit=5",
        "/artist/7/albums?limit=200",
    ]);
});

test("DeezerAlbumSource finds nothing when Deezer has neither the artist nor the album", async () => {
    const requested = mockDeezer({
        "/search/artist": { data: [{ id: 1, name: "Scorpions Tribute" }] },
    });

    assert.equal(await findDeezerAlbum(acoustica), null);
    assert.equal(requested.length, 2);

    mockDeezer({
        "/search/artist": { data: [{ id: 7, name: "Scorpions" }] },
        "/artist/7/albums": { data: [{ title: "MTV Unplugged" }] },
    });
    assert.equal(await findDeezerAlbum(acoustica), null);
});

test("DeezerAlbumSource prefers the artist named exactly over a collaboration", async () => {
    const requested = mockDeezer({
        "/search/artist": {
            data: [
                { id: 1, name: "Scorpions & Friends" },
                { id: 7, name: "Scorpions" },
            ],
        },
        "/artist/7/albums": { data: [{ title: "Acoustica" }] },
    });

    assert.equal((await findDeezerAlbum(acoustica))?.album, "Acoustica");
    assert.ok(requested.includes("/artist/7/albums?limit=200"));
});

test("DeezerAlbumSource does not list the albums of various artists", async () => {
    const requested = mockDeezer({});

    assert.equal(
        await findDeezerAlbum({ artist: "Various Artists", album: "Hits 90" }),
        null
    );
    assert.deepEqual(requested, [
        "/search/album?q=Various+Artists+Hits+90&limit=5",
    ]);
});

test("DeezerAlbumSource searches each artist and lists its albums once per batch", async () => {
    const requested = mockDeezer({
        "/search/artist": {
            data: [{ name: "Scorpions" }, { id: 7, name: "Scorpions" }],
        },
        "/artist/7/albums": { data: [{ title: "Acoustica" }] },
    });
    const services = createProviderServices();
    const source = new DeezerAlbumSource(new DeezerClient(services), services);

    await source.findAlbum(acoustica);
    await source.findAlbum({ ...acoustica, album: "Crazy World" });

    assert.equal(
        requested.filter((url) => !url.startsWith("/search/album")).length,
        2
    );
});

test("DeezerAlbumSource falls back to an artist sharing the credit", async () => {
    mockDeezer({
        "/search/artist": { data: [{ id: 3, name: "Scorpions & Friends" }] },
        "/artist/3/albums": { data: [{ title: "Acoustica" }] },
    });

    assert.equal((await findDeezerAlbum(acoustica))?.album, "Acoustica");
});

test("DeezerAlbumSource gives the album artist, genre, year and tracklist", async () => {
    const requested = mockDeezer({
        "/search/album": {
            data: [
                {
                    id: 7,
                    title: "Discovery",
                    artist: { name: "Daft Punk" },
                    cover_xl: DEEZER_COVER_XL,
                },
            ],
        },
        "/album/7": {
            genres: { data: [{ name: "Electro" }] },
            release_date: "2001-03-12",
        },
        "/album/7/tracks": {
            data: [
                { title: "One More Time", track_position: 1, disk_number: 1 },
                { title: "Aerodynamic", track_position: 2, disk_number: 1 },
            ],
        },
    });

    const found = await findDeezerAlbum();

    assert.deepEqual(
        { ...found, covers: undefined },
        {
            album: "Discovery",
            artist: "Daft Punk",
            year: "2001",
            genre: "Electro",
            covers: undefined,
            tracks: [
                {
                    title: "One More Time",
                    trackNumber: 1,
                    trackCount: 2,
                    discNumber: 1,
                    discCount: 1,
                },
                {
                    title: "Aerodynamic",
                    trackNumber: 2,
                    trackCount: 2,
                    discNumber: 1,
                    discCount: 1,
                },
            ],
        }
    );
    assert.equal(requested.length, 3);
});

const discoveryResult = {
    data: [{ id: 7, title: "Discovery", artist: { name: "Daft Punk" } }],
};

test("DeezerAlbumSource keeps the album when its details cannot be read", async () => {
    mockDeezer({
        "/search/album": discoveryResult,
        "/album/7": { error: { message: "quota" } },
    });
    const services = createProviderServices({
        logger: createRecordingLogger(),
    });
    const client = new DeezerClient(services);

    const found = await services.lookups.call("Deezer", () =>
        new DeezerAlbumSource(client, services).findAlbum(search)
    );

    assert.equal(found?.album, "Discovery");
    assert.equal(found?.tracks, undefined);
});

test("DeezerAlbumSource reads no year from an unknown date and track artists", async () => {
    mockDeezer({
        "/search/album": discoveryResult,
        "/album/7": { release_date: "0000-00-00" },
        "/album/7/tracks": {
            data: [
                {
                    title: "Digital Love",
                    artist: { name: "Daft Punk" },
                    track_position: 3,
                },
            ],
        },
    });

    const found = await findDeezerAlbum();

    assert.equal(found?.year, undefined);
    assert.deepEqual(found?.tracks?.[0], {
        title: "Digital Love",
        artist: "Daft Punk",
        trackNumber: 3,
        trackCount: 1,
        discNumber: 1,
        discCount: 1,
    });
});
