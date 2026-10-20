import assert from "node:assert/strict";
import { test } from "node:test";
import { CoverOverlay } from "../../src/tui/cover-overlay.js";
import {
    buildDeletion,
    buildPlacement,
    buildPlacementDeletion,
    buildTransmission,
} from "../../src/tui/kitty-graphics.js";
import type { PngCover } from "../../src/tui/types.js";

const FIRST_ID = 4100;
const SPOT = { row: 4, column: 53, columns: 48, rows: 24 };

function createCover(key: string): PngCover {
    return { png: Buffer.from(key), key, width: 48, height: 48 };
}

const FIRST = createCover("first");
const SECOND = createCover("second");

function createOverlay() {
    const writes: string[] = [];
    const overlay = new CoverOverlay((text) => writes.push(text));
    return { overlay, writes };
}

test("CoverOverlay sends a new cover once, then places it", () => {
    const { overlay, writes } = createOverlay();

    overlay.show(FIRST, SPOT);
    overlay.show({ ...FIRST, png: Buffer.from("first") }, SPOT);

    assert.deepEqual(writes, [
        buildTransmission(FIRST.png, FIRST_ID),
        buildPlacement(SPOT, FIRST_ID),
    ]);
});

test("CoverOverlay moves the cover without sending it again", () => {
    const { overlay, writes } = createOverlay();
    const moved = { ...SPOT, row: 6 };

    overlay.show(FIRST, SPOT);
    overlay.show(FIRST, moved);

    assert.deepEqual(writes.slice(2), [buildPlacement(moved, FIRST_ID)]);
});

test("CoverOverlay places the next cover before removing the previous one", () => {
    const { overlay, writes } = createOverlay();

    overlay.show(FIRST, SPOT);
    overlay.show(SECOND, SPOT);
    overlay.show(FIRST, SPOT);

    assert.deepEqual(writes.slice(2), [
        buildTransmission(SECOND.png, FIRST_ID + 1),
        buildPlacement(SPOT, FIRST_ID + 1),
        buildPlacementDeletion(FIRST_ID),
        buildPlacement(SPOT, FIRST_ID),
        buildPlacementDeletion(FIRST_ID + 1),
    ]);
});

test("CoverOverlay frees the least recently shown cover beyond eight", () => {
    const { overlay, writes } = createOverlay();
    const covers = Array.from({ length: 9 }, (_, index) =>
        createCover(`cover ${index}`)
    );

    covers.forEach((cover) => overlay.show(cover, SPOT));

    assert.ok(writes.includes(buildDeletion(FIRST_ID)));
    assert.ok(writes.includes(buildTransmission(covers[8].png, FIRST_ID)));
});

test("CoverOverlay hides the placement and shows the kept cover again", () => {
    const { overlay, writes } = createOverlay();

    overlay.hide();
    overlay.show(FIRST, SPOT);
    overlay.hide();
    overlay.hide();
    overlay.show(FIRST, SPOT);

    assert.deepEqual(writes, [
        buildTransmission(FIRST.png, FIRST_ID),
        buildPlacement(SPOT, FIRST_ID),
        buildPlacementDeletion(FIRST_ID),
        buildPlacement(SPOT, FIRST_ID),
    ]);
});

test("CoverOverlay places the cover again once invalidated", () => {
    const { overlay, writes } = createOverlay();

    overlay.invalidate();
    overlay.show(FIRST, SPOT);
    overlay.invalidate();
    overlay.show(FIRST, SPOT);

    assert.deepEqual(writes.slice(2), [buildPlacement(SPOT, FIRST_ID)]);
});

test("CoverOverlay frees every sent cover on clear", () => {
    const { overlay, writes } = createOverlay();
    overlay.show(FIRST, SPOT);
    overlay.show(SECOND, SPOT);

    overlay.clear();
    overlay.hide();

    assert.deepEqual(writes.slice(-2), [
        buildDeletion(FIRST_ID),
        buildDeletion(FIRST_ID + 1),
    ]);
});
