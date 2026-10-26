import assert from "node:assert/strict";
import { test } from "node:test";
import { isSameFilename } from "../../src/library/folder-names.js";

test("isSameFilename ignores letter case and Unicode normalization", () => {
    assert.equal(
        isSameFilename("artist - title.mp3", "Artist - Title.MP3"),
        true
    );
    assert.equal(isSameFilename("Bjo\u0308rk.mp3", "Bj\u00f6rk.mp3"), true);
    assert.equal(isSameFilename("01 Title.mp3", "Artist - Title.mp3"), false);
});
