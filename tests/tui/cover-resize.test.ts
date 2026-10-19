import assert from "node:assert/strict";
import { test } from "node:test";
import { resizeCoverArt } from "../../src/tui/cover-resize.js";
import type { CoverArt } from "../../src/tui/types.js";

function createSplitArt(size: number): CoverArt {
    const pixels = new Uint8Array(size * size * 3);
    for (let index = 0; index < size * size; index++) {
        const isTop = index < (size * size) / 2;
        pixels.set(isTop ? [200, 0, 0] : [0, 0, 100], index * 3);
    }
    return { width: size, height: size, pixels };
}

test("resizeCoverArt keeps a cover that already has the size", () => {
    const art = createSplitArt(4);

    assert.equal(resizeCoverArt(art, 4), art);
});

test("resizeCoverArt averages the pixels each target pixel covers", () => {
    const resized = resizeCoverArt(createSplitArt(4), 2);

    assert.equal(resized.width, 2);
    assert.equal(resized.height, 2);
    assert.deepEqual(
        [...resized.pixels],
        [200, 0, 0, 200, 0, 0, 0, 0, 100, 0, 0, 100]
    );
});

test("resizeCoverArt blends the pixels under a target pixel", () => {
    const resized = resizeCoverArt(createSplitArt(3), 2);

    assert.deepEqual([...resized.pixels.subarray(9, 12)], [50, 0, 75]);
});

test("resizeCoverArt repeats pixels when enlarging", () => {
    const resized = resizeCoverArt(createSplitArt(2), 4);

    assert.deepEqual([...resized.pixels.subarray(0, 3)], [200, 0, 0]);
    assert.deepEqual([...resized.pixels.subarray(15 * 3)], [0, 0, 100]);
});
