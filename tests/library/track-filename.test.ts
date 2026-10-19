import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTrackFilename } from "../../src/library/track-filename.js";

test("buildTrackFilename joins artist and title and keeps the extension", () => {
    assert.equal(
        buildTrackFilename({ artist: " Artist ", title: " Title " }, ".MP3"),
        "Artist - Title.MP3"
    );
});

test("buildTrackFilename replaces characters that filenames cannot hold", () => {
    assert.equal(
        buildTrackFilename(
            { artist: "AC/DC", title: 'What? <Live> "1" | a\\b: c*\u0001' },
            ".flac"
        ),
        "AC_DC - What_ _Live_ _1_ _ a_b_ c__.flac"
    );
});

test("buildTrackFilename never produces a hidden name", () => {
    assert.equal(
        buildTrackFilename({ artist: "...And You", title: "Title" }, ".mp3"),
        "_..And You - Title.mp3"
    );
});

test("buildTrackFilename truncates long names to 200 bytes on a character boundary", () => {
    const filename = buildTrackFilename(
        { artist: "Artist", title: "é".repeat(200) },
        ".flac"
    );

    assert.ok(filename.endsWith("é.flac"));
    assert.ok(Buffer.byteLength(filename) <= 200);
    assert.ok(Buffer.byteLength(filename) >= 199);
});

test("buildTrackFilename keeps the title when the artist is very long", () => {
    const filename = buildTrackFilename(
        { artist: "A".repeat(195), title: "Title" },
        ".mp3"
    );

    assert.ok(filename.endsWith(" - Title.mp3"));
    assert.ok(Buffer.byteLength(filename) <= 200);
});
