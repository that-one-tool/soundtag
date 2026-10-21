import assert from "node:assert/strict";
import { test } from "node:test";
import { DeezerClient } from "../../../src/metadata/providers/deezer-client.js";
import { DeezerCoverProvider } from "../../../src/metadata/providers/deezer-cover.js";
import type {
    ProviderServices,
    TrackSearch,
} from "../../../src/metadata/types.js";
import { DEEZER_COVER_XL, mockDeezer } from "../../helpers/deezer.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createProviderServices } from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();

const search: TrackSearch = {
    title: "One More Time",
    artist: "Daft Punk",
    album: "Discovery",
};
const lookalike = {
    title: "Discovery",
    artist: { name: "Data Punk" },
    cover_xl: "https://cdn.deezer.test/lookalike.jpg",
};
const searchedAlbum = {
    title: "Discovery",
    artist: { name: "Daft Punk" },
    cover_xl: DEEZER_COVER_XL,
};

function findDeezerCover(
    coverSearch: TrackSearch,
    services: ProviderServices = createProviderServices()
): Promise<Buffer | null> {
    return new DeezerCoverProvider(
        new DeezerClient(services),
        services
    ).findCover(coverSearch);
}

test("DeezerCoverProvider downloads the cover of the searched album", async () => {
    const requested = mockDeezer({
        "/search/album": { data: [lookalike, searchedAlbum] },
    });

    const cover = await findDeezerCover(search);

    assert.deepEqual(cover, Buffer.from("image /1000x1000.jpg"));
    assert.deepEqual(requested, [
        "/search/album?q=Daft+Punk+Discovery&limit=5",
        "/1000x1000.jpg",
    ]);
});

test("DeezerCoverProvider accepts any artist when none is searched", async () => {
    mockDeezer({ "/search/album": { data: [lookalike] } });

    const cover = await findDeezerCover({ ...search, artist: "" });

    assert.deepEqual(cover, Buffer.from("image /lookalike.jpg"));
});

test("DeezerCoverProvider skips the search without an album", async () => {
    const requested = mockDeezer({});

    assert.equal(await findDeezerCover({ ...search, album: "" }), null);
    assert.deepEqual(requested, []);
});

test("DeezerCoverProvider returns null when no album matches", async () => {
    mockDeezer({ "/search/album": { data: [lookalike] } });

    assert.equal(await findDeezerCover(search), null);
});

test("DeezerCoverProvider lets a failed search reach the lookup log", async () => {
    globalThis.fetch = async () => new Response(null, { status: 500 });

    await assert.rejects(
        findDeezerCover(search, createProviderServices()),
        /HTTP 500/
    );
});
