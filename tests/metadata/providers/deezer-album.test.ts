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
