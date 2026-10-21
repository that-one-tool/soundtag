import assert from "node:assert/strict";
import { test } from "node:test";
import type { LogLine } from "../../src/tui/log-buffer.js";
import {
    getActiveAnchor,
    getLogWindow,
    scrollLog,
} from "../../src/tui/log-scroll.js";

function createLines(texts: string[], firstId = 0): LogLine[] {
    return texts.map((text, index) => ({
        id: firstId + index,
        text,
        isError: false,
    }));
}

function getTexts(lines: readonly LogLine[]): string[] {
    return lines.map((line) => line.text);
}

const LINES = createLines(["a", "b", "c", "d", "e"]);

test("getLogWindow follows the latest lines without an anchor", () => {
    const window = getLogWindow(LINES, 2, null);

    assert.deepEqual(getTexts(window.lines), ["d", "e"]);
    assert.equal(window.hiddenBelow, 0);
});

test("getLogWindow ends at the anchored line", () => {
    const window = getLogWindow(LINES, 2, 2);

    assert.deepEqual(getTexts(window.lines), ["b", "c"]);
    assert.equal(window.hiddenBelow, 2);
});

test("getLogWindow keeps its place when the anchored row was replaced", () => {
    const rows = [0, 1, 2, 2.001, 3].map((id) => ({
        id,
        text: String(id),
        isError: false,
    }));

    const window = getLogWindow(
        rows.filter(({ id }) => id !== 2.001),
        2,
        2.001
    );

    assert.deepEqual(getTexts(window.lines), ["1", "2"]);
    assert.equal(window.hiddenBelow, 1);
});

test("getLogWindow shows an older line instead of a leading blank one", () => {
    const lines = createLines(["first", "", "second", "third"]);

    const window = getLogWindow(lines, 3, null);

    assert.deepEqual(getTexts(window.lines), ["first", "second", "third"]);
});

test("getLogWindow shows the oldest lines once the anchor was dropped", () => {
    const lines = createLines(["x", "y", "z"], 10);

    const window = getLogWindow(lines, 2, 3);

    assert.deepEqual(getTexts(window.lines), ["x", "y"]);
});

test("scrollLog anchors on an earlier line when scrolling up", () => {
    assert.equal(scrollLog(LINES, 2, { anchorId: null, delta: -1 }), 3);
    assert.equal(scrollLog(LINES, 2, { anchorId: 3, delta: -5 }), 1);
});

test("scrollLog follows the latest lines again at the bottom", () => {
    assert.equal(scrollLog(LINES, 2, { anchorId: 2, delta: 1 }), 3);
    assert.equal(scrollLog(LINES, 2, { anchorId: 3, delta: 1 }), null);
    assert.equal(scrollLog(LINES, 9, { anchorId: null, delta: -1 }), null);
});

test("scrollLog stops at the oldest page", () => {
    assert.equal(scrollLog(LINES, 2, { anchorId: null, delta: -99 }), 1);
});

test("scrollLog keeps following a log that fits the pane", () => {
    assert.equal(scrollLog([], 2, { anchorId: null, delta: -1 }), null);
    assert.equal(scrollLog(LINES, 5, { anchorId: null, delta: -1 }), null);
});

test("getLogWindow shows the oldest page for an anchor near the top", () => {
    const window = getLogWindow(LINES, 3, 0);

    assert.deepEqual(getTexts(window.lines), ["a", "b", "c"]);
    assert.equal(window.hiddenBelow, 2);
});

test("getActiveAnchor follows the latest lines once the pane size changed", () => {
    const anchor = { anchorId: 3, height: 5, width: 80 };

    assert.equal(getActiveAnchor(anchor, { height: 5, width: 80 }), 3);
    assert.equal(getActiveAnchor(anchor, { height: 12, width: 80 }), null);
    assert.equal(getActiveAnchor(anchor, { height: 5, width: 60 }), null);
});
