import assert from "node:assert/strict";
import { test } from "node:test";
import { getWritePolicy } from "../../src/processing/write-policy.js";

const stored = {
    info: { title: "Song", artist: "Artist", album: "Album", year: "1990" },
    extras: { genre: "Rock", trackNumber: 5, trackCount: 12 },
    hasCover: true,
};

const found = {
    info: { title: "Song", artist: "Artist", album: "", year: "1991" },
    extras: { genre: "Rock", trackNumber: 3 },
    coverData: null,
};

test("the fill policy skips tagged tracks and keeps the stored tags", () => {
    const policy = getWritePolicy(false);

    assert.equal(policy.skipsTaggedTrack(stored), true);
    assert.equal(policy.replacesCover, false);
    assert.equal(policy.getSearchedTags(stored), stored);
    assert.equal(policy.getChanges(stored, found), null);
});

test("the overwrite policy searches from no tags but keeps the stored cover", () => {
    const policy = getWritePolicy(true);

    assert.equal(policy.skipsTaggedTrack(stored), false);
    assert.equal(policy.replacesCover, true);
    assert.deepEqual(policy.getSearchedTags(stored), {
        info: { title: "", artist: "", album: "", year: "" },
        extras: {},
        hasCover: true,
    });
});

test("the overwrite policy writes changed fields and clears stale counts", () => {
    assert.deepEqual(getWritePolicy(true).getChanges(stored, found), {
        info: found.info,
        extras: { trackNumber: 3 },
        coverData: null,
        clearedExtras: ["trackCount"],
    });
});

test("the overwrite policy writes nothing when nothing differs", () => {
    const same = { ...found, info: stored.info, extras: stored.extras };

    assert.equal(getWritePolicy(true).getChanges(stored, same), null);
});

const albumTags = {
    info: { title: "Song", artist: "Band", album: "Jazz", year: "1978" },
    extras: { genre: "Pop", albumArtist: "Band", trackNumber: 2 },
    coverData: Buffer.from("album cover"),
};

test("the fill policy keeps the stored values over the album's", () => {
    assert.deepEqual(getWritePolicy(false).keepStored(stored, albumTags), {
        info: { title: "Song", artist: "Artist", album: "Album", year: "1990" },
        extras: {
            genre: "Rock",
            albumArtist: "Band",
            trackNumber: 5,
            trackCount: 12,
        },
        coverData: null,
    });
});

test("the overwrite policy keeps none of the stored values", () => {
    assert.equal(getWritePolicy(true).keepStored(stored, albumTags), albumTags);
});
