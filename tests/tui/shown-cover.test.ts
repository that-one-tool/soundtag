import assert from "node:assert/strict";
import { test } from "node:test";
import { getShownCover } from "../../src/tui/shown-cover.js";
import type { BrowserEntry, CoverLookup } from "../../src/tui/types.js";

const ART = { width: 2, height: 2, pixels: new Uint8Array(12) };
const SONG: BrowserEntry = { name: "a.mp3", path: "/a.mp3", kind: "file" };
const OTHER: BrowserEntry = { name: "b.mp3", path: "/b.mp3", kind: "file" };
const FOUND: CoverLookup = { kind: "found", art: ART };

test("getShownCover shows the found cover of the shown entry", () => {
    const cover = { entry: { ...SONG }, value: FOUND, loading: true };

    assert.equal(getShownCover(SONG, cover), ART);
});

test("getShownCover hides the cover of another entry", () => {
    const cover = { entry: OTHER, value: FOUND, loading: false };

    assert.equal(getShownCover(SONG, cover), null);
    assert.equal(getShownCover(undefined, cover), null);
});

test("getShownCover shows nothing for a missing or unread cover", () => {
    const missing: CoverLookup = { kind: "missing" };

    assert.equal(
        getShownCover(SONG, { entry: SONG, value: missing, loading: false }),
        null
    );
    assert.equal(
        getShownCover(SONG, { entry: SONG, value: null, loading: false }),
        null
    );
});
