import assert from "node:assert/strict";
import { test } from "node:test";
import { MusicBrainzAlbumSource } from "../../../src/metadata/providers/musicbrainz-album.js";
import { MusicBrainzClient } from "../../../src/metadata/providers/musicbrainz-client.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createProviderServices } from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();

const search = { artist: "Daft Punk", album: "discovery" };

function mockReleaseGroups(groups: unknown[]): void {
    globalThis.fetch = async () => Response.json({ "release-groups": groups });
}

function findMusicBrainzAlbum() {
    const client = new MusicBrainzClient(
        "SoundTag/1.0",
        createProviderServices()
    );
    return new MusicBrainzAlbumSource(client).findAlbum(search);
}

test("MusicBrainzAlbumSource gives the searched release group and its cover", async () => {
    mockReleaseGroups([
        {
            id: "other",
            title: "Discovery",
            "artist-credit": [{ name: "Data Punk" }],
        },
        {
            id: "group",
            title: "Discovery",
            "artist-credit": [{ name: "Daft Punk" }],
        },
    ]);

    const found = await findMusicBrainzAlbum();

    assert.equal(found?.album, "Discovery");
    assert.deepEqual(
        found?.covers.map(({ url }) => url.toString()),
        [
            "https://coverartarchive.org/release-group/group/front-1200",
            "https://coverartarchive.org/release-group/group/front-500",
        ]
    );
});

test("MusicBrainzAlbumSource finds nothing without the same album", async () => {
    mockReleaseGroups([
        {
            id: "live",
            title: "Alive 2007",
            "artist-credit": [{ name: "Daft Punk" }],
        },
    ]);

    assert.equal(await findMusicBrainzAlbum(), null);
});

test("MusicBrainzAlbumSource gives no cover for a release group without an id", async () => {
    mockReleaseGroups([
        { title: "Discovery", "artist-credit": [{ name: "Daft Punk" }] },
    ]);

    assert.deepEqual(await findMusicBrainzAlbum(), {
        album: "Discovery",
        artist: "Daft Punk",
        covers: [],
    });
});

test("MusicBrainzAlbumSource gives the artist and first release year", async () => {
    mockReleaseGroups([
        {
            id: "group",
            title: "Discovery",
            "artist-credit": [{ name: "Daft Punk" }],
            "first-release-date": "2001-03-07",
        },
    ]);

    const found = await findMusicBrainzAlbum();

    assert.equal(found?.artist, "Daft Punk");
    assert.equal(found?.year, "2001");
});
