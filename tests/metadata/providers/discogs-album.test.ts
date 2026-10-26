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
        artist: "Daft Punk",
        covers: [],
        tracks: [],
    });

    mockSearchByType({});
    assert.equal(await findDiscogsAlbum(), null);
});

test("DiscogsAlbumSource gives the master's artist, year, genre and tracklist", async () => {
    mockDiscogs({
        "/database/search": { results: [{ id: 8 }] },
        "/masters/8": {
            ...discovery,
            year: 2001,
            genres: ["Electronic"],
            tracklist: [
                { position: "1", title: "One More Time" },
                { position: "", type_: "heading", title: "Bonus" },
                { position: "2", title: "Aerodynamic" },
            ],
        },
    });

    const found = await findDiscogsAlbum();

    assert.deepEqual(
        { ...found, covers: undefined },
        {
            album: "Discovery",
            artist: "Daft Punk",
            year: "2001",
            genre: "Electronic",
            covers: undefined,
            tracks: [
                {
                    title: "One More Time",
                    artist: "Daft Punk",
                    trackNumber: 1,
                    trackCount: 2,
                    discNumber: 1,
                    discCount: 1,
                },
                {
                    title: "Aerodynamic",
                    artist: "Daft Punk",
                    trackNumber: 2,
                    trackCount: 2,
                    discNumber: 1,
                    discCount: 1,
                },
            ],
        }
    );
});

test("DiscogsAlbumSource gives no year from a release, which can be a reissue", async () => {
    mockSearchByType({ release: [{ id: 3 }] });

    const found = await findDiscogsAlbum();

    assert.equal(found?.year, undefined);
});

function mockMaster(tracklist: unknown[]): void {
    mockDiscogs({
        "/database/search": { results: [{ id: 8 }] },
        "/masters/8": { ...discovery, tracklist },
    });
}

test("DiscogsAlbumSource places an index track as one song with its artist", async () => {
    mockMaster([
        { position: "1", title: "Intro", artists: [{ name: "Guest" }] },
        {
            position: "2",
            type_: "index",
            title: "Suite",
            sub_tracks: [{ position: "2a" }, { position: "2b" }],
        },
    ]);

    const found = await findDiscogsAlbum();

    assert.deepEqual(
        found?.tracks?.map(({ title, artist, trackNumber }) => [
            title,
            artist,
            trackNumber,
        ]),
        [
            ["Intro", "Guest", 1],
            ["Suite", "Daft Punk", 2],
        ]
    );
});

test("DiscogsAlbumSource gives no tracklist when a song has no place", async () => {
    mockMaster([
        { position: "1", title: "One" },
        { position: "B1", title: "Two" },
    ]);

    assert.deepEqual((await findDiscogsAlbum())?.tracks, []);
});
