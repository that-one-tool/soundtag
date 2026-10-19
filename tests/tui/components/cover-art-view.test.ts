import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { stripVTControlCharacters } from "node:util";
import { Box } from "ink";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import {
    buildCoverRows,
    CoverArtView,
} from "../../../src/tui/components/cover-art-view.js";

afterEach(() => cleanup());

test("CoverArtView draws two pixel rows per text row", () => {
    const cover = { width: 4, height: 4, pixels: new Uint8Array(4 * 4 * 3) };

    const view = createElement(CoverArtView, { cover, size: 4 });
    const frame = render(view).lastFrame();

    assert.deepEqual(stripVTControlCharacters(frame ?? "").split("\n"), [
        "▀▀▀▀",
        "▀▀▀▀",
    ]);
});

test("buildCoverRows colors the upper pixel and the lower pixel's background", () => {
    const pixels = new Uint8Array([255, 16, 1, 0, 0, 9]);

    const [row] = buildCoverRows({ width: 1, height: 2, pixels });

    assert.equal(row, "\u001B[38;2;255;16;1m\u001B[48;2;0;0;9m▀\u001B[0m");
});

test("CoverArtView cuts its rows instead of wrapping them in a narrow box", () => {
    const cover = { width: 6, height: 6, pixels: new Uint8Array(6 * 6 * 3) };
    const narrow = createElement(
        Box,
        { width: 3 },
        createElement(CoverArtView, { cover, size: 6 })
    );

    const frame = stripVTControlCharacters(render(narrow).lastFrame() ?? "");

    assert.equal(frame.split("\n").length, 3);
});

test("CoverArtView draws the cover at the given size", () => {
    const cover = { width: 4, height: 4, pixels: new Uint8Array(4 * 4 * 3) };

    const view = createElement(CoverArtView, { cover, size: 2 });
    const frame = render(view).lastFrame();

    assert.deepEqual(stripVTControlCharacters(frame ?? "").split("\n"), ["▀▀"]);
});
