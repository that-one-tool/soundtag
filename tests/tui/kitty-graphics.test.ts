import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildDeletion,
    buildPlacement,
    buildPlacementDeletion,
    buildTransmission,
} from "../../src/tui/kitty-graphics.js";

const ESC = "\u001B";

test("buildTransmission sends a PNG in chunks without replies", () => {
    const png = Buffer.alloc(7000, 1);
    const base64 = png.toString("base64");

    const chunks = buildTransmission(png, 7).split(`${ESC}\\`).slice(0, -1);

    assert.deepEqual(chunks, [
        `${ESC}_Ga=t,f=100,i=7,q=2,m=1;${base64.slice(0, 4096)}`,
        `${ESC}_Gm=1;${base64.slice(4096, 8192)}`,
        `${ESC}_Gm=0;${base64.slice(8192)}`,
    ]);
});

test("buildTransmission sends a small PNG in one chunk", () => {
    const png = Buffer.from("png");

    assert.equal(
        buildTransmission(png, 7),
        `${ESC}_Ga=t,f=100,i=7,q=2,m=0;cG5n${ESC}\\`
    );
});

test("buildPlacement fits the image to its cells and restores the cursor", () => {
    const placement = { row: 4, column: 53, columns: 48, rows: 20 };

    assert.equal(
        buildPlacement(placement, 7),
        `${ESC}7${ESC}[5;54H${ESC}_Ga=p,i=7,p=1,c=48,r=20,C=1,q=2${ESC}\\${ESC}8`
    );
});

test("buildDeletion frees the image and its placements", () => {
    assert.equal(buildDeletion(7), `${ESC}_Ga=d,d=I,i=7,q=2${ESC}\\`);
});

test("buildTransmission sends nothing for an empty image", () => {
    assert.equal(buildTransmission(Buffer.alloc(0), 7), "");
});

test("buildPlacementDeletion removes the placements and keeps the image", () => {
    assert.equal(buildPlacementDeletion(7), `${ESC}_Ga=d,d=i,i=7,q=2${ESC}\\`);
});
