import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTracklist } from "../../src/metadata/album-tracklist.js";

test("buildTracklist counts the tracks of each disc and the discs", () => {
    assert.deepEqual(
        buildTracklist([
            { title: "A", disc: 1, track: 1 },
            { title: "B", disc: 2, track: 1 },
            { title: "C", disc: 2, track: 2 },
        ]),
        [
            {
                title: "A",
                trackNumber: 1,
                trackCount: 1,
                discNumber: 1,
                discCount: 2,
            },
            {
                title: "B",
                trackNumber: 1,
                trackCount: 2,
                discNumber: 2,
                discCount: 2,
            },
            {
                title: "C",
                trackNumber: 2,
                trackCount: 2,
                discNumber: 2,
                discCount: 2,
            },
        ]
    );
    assert.deepEqual(buildTracklist([]), []);
});

test("buildTracklist keeps each track artist", () => {
    assert.equal(
        buildTracklist([{ title: "A", artist: "X", disc: 1, track: 1 }])[0]
            .artist,
        "X"
    );
});

test("buildTracklist gives nothing when two tracks share a place", () => {
    assert.deepEqual(
        buildTracklist([
            { title: "A", disc: 1, track: 1 },
            { title: "B", disc: 1, track: 1 },
        ]),
        []
    );
});
