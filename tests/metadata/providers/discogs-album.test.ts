import assert from "node:assert/strict";
import { test } from "node:test";
import { DiscogsAlbumSource } from "../../../src/metadata/providers/discogs-album.js";
import { DiscogsClient } from "../../../src/metadata/providers/discogs-client.js";
import { DISCOGS_COVER, mockDiscogs } from "../../helpers/discogs.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createProviderServices } from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();

const search = { artist: "Daft Punk", album: "discovery" };
const discovery = {
    title: "Discovery",
    artists: [{ name: "Daft Punk (2)" }],
    images: [{ type: "primary", uri: DISCOGS_COVER }],
};

function findDiscogsAlbum() {
    const client = new DiscogsClient(
        { key: "key", secret: "secret" },
        createProviderServices()
    );
    return new DiscogsAlbumSource(client).findAlbum(search);
}

// Masters and releases share the search path, so the type tells them apart.
function mockSearchByType(results: Record<string, unknown[]>): string[] {
    const searched: string[] = [];
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        const type = url.searchParams.get("type") ?? "";
        searched.push(`${url.pathname} ${type}`);
        return url.pathname === "/database/search"
            ? Response.json({ results: results[type] ?? [] })
            : Response.json(discovery);
    };
    return searched;
}

test("DiscogsAlbumSource gives the master of the searched album and its cover", async () => {
    const requested = mockDiscogs({
        "/database/search": { results: [{ id: 8 }] },
        "/masters/8": discovery,
    });

    const found = await findDiscogsAlbum();

    assert.equal(found?.album, "Discovery");
    assert.deepEqual(
        found?.covers.map(({ url }) => url.toString()),
        [DISCOGS_COVER]
    );
    const params = requested[0].url.searchParams;
    assert.equal(params.get("release_title"), "discovery");
    assert.equal(params.get("artist"), "Daft Punk");
    assert.equal(params.get("track"), null);
});

test("DiscogsAlbumSource falls back to releases without a master", async () => {
    const searched = mockSearchByType({ release: [{ id: 3 }] });

    assert.equal((await findDiscogsAlbum())?.album, "Discovery");
    assert.deepEqual(searched, [
        "/database/search master",
        "/database/search release",
        "/releases/3 ",
    ]);
});

test("DiscogsAlbumSource skips another album and may have no cover", async () => {
    mockDiscogs({
        "/database/search": { results: [{ id: 8 }] },
        "/masters/8": { ...discovery, title: "Homework", images: undefined },
        "/releases/8": { ...discovery, images: [] },
    });

    assert.deepEqual(await findDiscogsAlbum(), {
        album: "Discovery",
        covers: [],
    });

    mockSearchByType({});
    assert.equal(await findDiscogsAlbum(), null);
});
