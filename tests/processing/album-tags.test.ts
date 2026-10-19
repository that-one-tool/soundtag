import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { getAlbumKey, readKnownTags } from "../../src/processing/album-tags.js";
import { getTagStore } from "../../src/tags/audio-tags.js";
import type { StoredTags } from "../../src/tags/types.js";
import { emptyInfo } from "../helpers/metadata-chain.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-album-tags-test-"
);

const albumInfo = { ...emptyInfo, artist: "Artist", album: "Album" };

test("getAlbumKey ignores case, spaces and Unicode forms", () => {
    assert.equal(
        getAlbumKey(albumInfo),
        getAlbumKey({ ...emptyInfo, artist: " ARTIST ", album: "album" })
    );
    assert.equal(
        getAlbumKey({ ...emptyInfo, artist: "Beyoncé", album: "A" }),
        getAlbumKey({ ...emptyInfo, artist: "Beyoncé", album: "A" })
    );
});

test("getAlbumKey tells apart artists and albums", () => {
    assert.notEqual(
        getAlbumKey(albumInfo),
        getAlbumKey({ ...albumInfo, album: "Other" })
    );
    assert.notEqual(
        getAlbumKey({ ...emptyInfo, artist: "a", album: "bc" }),
        getAlbumKey({ ...emptyInfo, artist: "ab", album: "c" })
    );
});

test("getAlbumKey needs both an artist and an album", () => {
    assert.equal(getAlbumKey({ ...albumInfo, artist: " " }), null);
    assert.equal(getAlbumKey({ ...albumInfo, album: "" }), null);
});

test("readKnownTags prefers the tags already known for a file", async () => {
    const known: StoredTags = { info: albumInfo, extras: {}, hasCover: true };
    const file = path.join(await createTemporaryDirectory(), "missing.mp3");

    assert.equal(await readKnownTags(file, new Map([[file, known]])), known);
});

test("readKnownTags reads unknown files from disk", async () => {
    const file = path.join(await createTemporaryDirectory(), "track.mp3");
    await fs.writeFile(file, "audio bytes");
    await getTagStore(file).write(file, {
        info: albumInfo,
        extras: {},
        coverData: null,
    });

    const tags = await readKnownTags(file, new Map());

    assert.equal(tags.info.album, "Album");
});
