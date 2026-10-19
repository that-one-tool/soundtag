import assert from "node:assert/strict";
import { test } from "node:test";
import sharp from "sharp";
import { decodeWithSharp } from "../../src/tui/cover-decoder.js";
import { createDetailedJpeg, createSplitImage } from "../helpers/images.js";

test("decodeWithSharp resizes the image to RGB pixels", async () => {
    const cover = await decodeWithSharp(await createSplitImage(), {
        width: 2,
        height: 2,
    });

    assert.equal(cover.width, 2);
    assert.equal(cover.height, 2);
    const [topRed, , topBlue] = cover.pixels.subarray(0, 3);
    const [bottomRed, , bottomBlue] = cover.pixels.subarray(9, 12);
    assert.ok(topRed > 200 && topBlue < 55);
    assert.ok(bottomBlue > 200 && bottomRed < 55);
});

test("decodeWithSharp rejects bytes that are not an image", async () => {
    await assert.rejects(
        decodeWithSharp(Buffer.from("cover"), { width: 2, height: 2 })
    );
});

test("decodeWithSharp decodes a truncated JPEG", async () => {
    const jpeg = await createDetailedJpeg();
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length * 0.8));

    const cover = await decodeWithSharp(truncated, { width: 2, height: 2 });

    assert.equal(cover.pixels.length, 2 * 2 * 3);
});

test("decodeWithSharp draws transparent pixels black", async () => {
    const transparentRed = await sharp({
        create: {
            width: 2,
            height: 2,
            channels: 4,
            background: { r: 255, g: 0, b: 0, alpha: 0 },
        },
    })
        .png()
        .toBuffer();

    const cover = await decodeWithSharp(transparentRed, {
        width: 1,
        height: 1,
    });

    assert.deepEqual([...cover.pixels], [0, 0, 0]);
});
