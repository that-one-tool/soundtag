import assert from "node:assert/strict";
import { test } from "node:test";
import { DiscogsClient } from "../../../src/metadata/providers/discogs-client.js";
import { ServiceError } from "../../../src/shared/errors.js";
import { mockDiscogs } from "../../helpers/discogs.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createProviderServices } from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();

const credentials = { key: "consumer-key", secret: "consumer-secret" };

function createClient(): DiscogsClient {
    return new DiscogsClient(credentials, createProviderServices());
}

test("DiscogsClient searches a known album by artist and album only, with its consumer key", async () => {
    const requested = mockDiscogs({
        "/database/search": { results: [{ id: 3 }] },
    });

    const results = await createClient().searchAlbums("master", {
        title: "Digital Love",
        artist: "Daft Punk",
        album: "Discovery",
    });

    assert.deepEqual(results, [{ id: 3 }]);
    const [{ url, headers }] = requested;
    assert.deepEqual(Object.fromEntries(url.searchParams), {
        type: "master",
        artist: "Daft Punk",
        release_title: "Discovery",
        per_page: "1",
    });
    assert.equal(
        headers.get("authorization"),
        "Discogs key=consumer-key, secret=consumer-secret"
    );
    assert.match(headers.get("user-agent") ?? "", /^SoundTag\//);
});

test("DiscogsClient leaves out an unknown album and caches repeated requests", async () => {
    const requested = mockDiscogs({
        "/database/search": { results: [] },
        "/releases/5": { id: 5, title: "Discovery" },
    });
    const client = createClient();
    const search = { title: "Digital Love", artist: "Daft Punk", album: "" };

    await client.searchAlbums("release", search);
    await client.searchAlbums("release", search);
    await client.getAlbum("release", 5);
    const album = await client.getAlbum("release", 5);

    assert.equal(album.title, "Discovery");
    assert.equal(requested.length, 2);
    assert.equal(requested[0].url.searchParams.has("release_title"), false);
    assert.equal(requested[0].url.searchParams.get("track"), "Digital Love");
    assert.equal(requested[1].url.pathname, "/releases/5");
});

test("DiscogsClient reads masters from their own path", async () => {
    const requested = mockDiscogs({ "/masters/8": { id: 8 } });

    await createClient().getAlbum("master", 8);

    assert.equal(requested[0].url.pathname, "/masters/8");
});

test("DiscogsClient turns HTTP errors into service errors", async () => {
    globalThis.fetch = async () => new Response(null, { status: 429 });

    await assert.rejects(
        createClient().getAlbum("master", 1),
        (error) =>
            error instanceof ServiceError && /HTTP 429/.test(error.message)
    );
});

test("DiscogsClient asks for covers with its User-Agent", () => {
    const request = createClient().getCoverRequest(
        "https://i.discogs.test/a.jpg"
    );

    assert.equal(request.url, "https://i.discogs.test/a.jpg");
    assert.match(request.headers?.["User-Agent"] ?? "", /^SoundTag\//);
});

test("DiscogsClient searches every track of an album once", async () => {
    const requested = mockDiscogs({ "/database/search": { results: [] } });
    const client = createClient();
    const album = { artist: "Daft Punk", album: "Discovery" };

    await client.searchAlbums("master", { ...album, title: "Digital Love" });
    await client.searchAlbums("master", { ...album, title: "Aerodynamic" });

    assert.equal(requested.length, 1);
});
