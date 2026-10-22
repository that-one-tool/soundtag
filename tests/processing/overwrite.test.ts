import assert from "node:assert/strict";
import { test } from "node:test";
import { getOverwrite } from "../../src/processing/overwrite.js";
import type { TrackMetadata } from "../../src/metadata/types.js";
import type { StoredTags } from "../../src/tags/types.js";

const storedTags: StoredTags = {
    info: { title: "Title", artist: "Artist", album: "Album", year: "2001" },
    extras: {
        genre: "Rock",
        albumArtist: "Artist",
        trackNumber: 5,
        trackCount: 12,
        discNumber: 2,
        discCount: 3,
    },
    hasCover: true,
};
const storedCover = Buffer.from("cover");
const stored = { tags: storedTags, cover: storedCover };

function createFound(changes: Partial<TrackMetadata> = {}): TrackMetadata {
    return {
        info: storedTags.info,
        extras: storedTags.extras,
        coverData: Buffer.from("cover"),
        ...changes,
    };
}

test("getOverwrite finds nothing to write when the tags are the same", () => {
    assert.equal(getOverwrite(stored, createFound()), null);
});

test("getOverwrite writes only the fields that differ", () => {
    const found = createFound({
        info: { ...storedTags.info, title: "New Title", year: "1999" },
        extras: { ...storedTags.extras, genre: "Pop" },
    });

    assert.deepEqual(getOverwrite(stored, found), {
        info: { title: "New Title", artist: "", album: "", year: "1999" },
        extras: { genre: "Pop" },
        coverData: null,
        clearedExtras: [],
    });
});

test("getOverwrite writes a new cover", () => {
    const found = createFound({ coverData: Buffer.from("new cover") });

    assert.deepEqual(
        getOverwrite(stored, found)?.coverData,
        Buffer.from("new cover")
    );
});

test("getOverwrite keeps the stored count of a position on the same album", () => {
    const found = createFound({
        extras: { ...storedTags.extras, trackNumber: 3, trackCount: undefined },
    });

    const overwrite = getOverwrite(stored, found);

    assert.deepEqual(overwrite?.extras, { trackNumber: 3, trackCount: 12 });
    assert.deepEqual(overwrite?.clearedExtras, []);
});

test("getOverwrite finds nothing new in a position without its count", () => {
    const found = createFound({
        extras: { ...storedTags.extras, trackCount: undefined },
    });

    assert.equal(getOverwrite(stored, found), null);
});

test("getOverwrite ignores spaces around a found value", () => {
    const found = createFound({
        info: { ...storedTags.info, title: " Title " },
    });

    assert.equal(getOverwrite(stored, found), null);
});

test("getOverwrite clears release extras not found for a new album", () => {
    const found = createFound({
        info: { ...storedTags.info, album: "Other Album" },
        extras: { genre: "Rock", trackNumber: 3 },
    });

    const overwrite = getOverwrite(stored, found);

    assert.deepEqual(overwrite?.extras, { trackNumber: 3 });
    assert.deepEqual(overwrite?.clearedExtras, [
        "trackCount",
        "albumArtist",
        "discNumber",
        "discCount",
    ]);
});

test("getOverwrite keeps release extras when the album only changes case", () => {
    const found = createFound({
        info: { ...storedTags.info, album: "ALBUM" },
        extras: { genre: "Rock" },
    });

    assert.deepEqual(getOverwrite(stored, found)?.clearedExtras, []);
});

test("getOverwrite keeps release extras for a remaster of the album", () => {
    const found = createFound({
        info: { ...storedTags.info, album: "Album (Remastered)" },
        extras: { genre: "Rock" },
    });

    assert.deepEqual(getOverwrite(stored, found)?.clearedExtras, []);
});

test("getOverwrite keeps release extras when no album is found", () => {
    const found = createFound({
        info: { ...storedTags.info, album: "" },
        extras: { genre: "Rock" },
    });

    assert.equal(getOverwrite(stored, found), null);
});
