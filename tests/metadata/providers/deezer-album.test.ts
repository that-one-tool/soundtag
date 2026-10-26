import assert from "node:assert/strict";
import { test } from "node:test";
import { DeezerAlbumSource } from "../../../src/metadata/providers/deezer-album.js";
import { DeezerClient } from "../../../src/metadata/providers/deezer-client.js";
import { DEEZER_COVER_XL, mockDeezer } from "../../helpers/deezer.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createProviderServices } from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();

const search = { artist: "Daft Punk", album: "discovery" };

function findDeezerAlbum(albumSearch = search) {
    const client = new DeezerClient(createProviderServices());
    return new DeezerAlbumSource(client).findAlbum(albumSearch);
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
    const source = new DeezerAlbumSource(
        new DeezerClient(createProviderServices())
    );

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
