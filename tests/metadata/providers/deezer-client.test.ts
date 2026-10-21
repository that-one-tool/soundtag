import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildQuery,
    DeezerClient,
    getCoverRequests,
} from "../../../src/metadata/providers/deezer-client.js";
import { createFakeClock } from "../../helpers/clock.js";
import { mockDeezer } from "../../helpers/deezer.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createProviderServices } from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();

test("DeezerClient searches tracks and albums with a free-text query", async () => {
    const requested = mockDeezer({
        "/search": { data: [{ id: 1 }] },
        "/search/album": { data: [{ id: 2 }] },
    });
    const client = new DeezerClient(createProviderServices());

    assert.deepEqual(await client.searchTracks("Daft Punk One"), [{ id: 1 }]);
    assert.deepEqual(await client.searchAlbums("Daft Punk Disco"), [{ id: 2 }]);
    assert.deepEqual(requested, [
        "/search?q=Daft+Punk+One&limit=5",
        "/search/album?q=Daft+Punk+Disco&limit=5",
    ]);
});

test("DeezerClient returns no results when the list is missing", async () => {
    mockDeezer({ "/search": {} });

    const tracks = await new DeezerClient(
        createProviderServices()
    ).searchTracks("Title");

    assert.deepEqual(tracks, []);
});

test("DeezerClient loads each album and its tracks once per batch", async () => {
    const requested = mockDeezer({
        "/album/7": { id: 7, title: "Album" },
        "/album/7/tracks": { data: [{ id: 1, track_position: 3 }] },
    });
    const client = new DeezerClient(createProviderServices());

    await Promise.all([client.getAlbum(7), client.getAlbum(7)]);
    await client.getAlbumTracks(7);
    const tracks = await client.getAlbumTracks(7);

    assert.deepEqual(tracks, [{ id: 1, track_position: 3 }]);
    assert.deepEqual(requested, ["/album/7", "/album/7/tracks?limit=1000"]);
});

test("DeezerClient turns error payloads into failures", async () => {
    mockDeezer({
        "/album/0": { error: { type: "DataException", message: "no data" } },
        "/album/1": { error: {} },
    });
    const client = new DeezerClient(createProviderServices());

    await assert.rejects(client.getAlbum(0), /Deezer error: no data/);
    await assert.rejects(client.getAlbum(1), /Deezer error: unknown/);
});

test("DeezerClient reports HTTP failures", async () => {
    globalThis.fetch = async () => new Response(null, { status: 503 });

    await assert.rejects(
        new DeezerClient(createProviderServices()).searchTracks("Title"),
        /Deezer request failed: HTTP 503/
    );
});

test("DeezerClient spaces its requests 500 ms apart", async () => {
    const clock = createFakeClock();
    mockDeezer({});
    const client = new DeezerClient(createProviderServices({ clock }));

    await Promise.all([
        client.searchTracks("first"),
        client.searchAlbums("second"),
    ]);

    assert.deepEqual(clock.sleeps, [500]);
});

test("getCoverRequests prefers the largest cover and skips missing sizes", () => {
    assert.deepEqual(
        getCoverRequests({ cover_xl: "https://xl", cover_big: "https://big" }),
        [{ url: "https://xl" }, { url: "https://big" }]
    );
    assert.deepEqual(getCoverRequests({ cover_big: "https://big" }), [
        { url: "https://big" },
    ]);
    assert.deepEqual(getCoverRequests(undefined), []);
});

test("buildQuery joins the known search terms", () => {
    assert.equal(buildQuery(["", "Title"]), "Title");
    assert.equal(buildQuery(["Artist", "Title"]), "Artist Title");
});
