import assert from "node:assert/strict";
import { test } from "node:test";
import {
    getLayout,
    getLogWidth,
    getNameWidth,
    getPanelWidth,
} from "../../src/tui/layout.js";

test("getLayout gives the log pane a third of the terminal", () => {
    assert.deepEqual(getLayout(45), {
        logLines: 13,
        listHeight: 24,
        detailRows: 25,
    });
    assert.deepEqual(getLayout(60), {
        logLines: 18,
        listHeight: 34,
        detailRows: 35,
    });
});

test("getLayout keeps six log lines on small terminals", () => {
    assert.deepEqual(getLayout(24), {
        logLines: 6,
        listHeight: 10,
        detailRows: 11,
    });
    assert.equal(getLayout(10).logLines, 6);
});

test("getLayout keeps a minimum list height", () => {
    assert.equal(getLayout(10).listHeight, 3);
});

test("getPanelWidth fits the cover but takes at most half the terminal", () => {
    assert.equal(getPanelWidth(200), 52);
    assert.equal(getPanelWidth(80), 40);
    assert.equal(getPanelWidth(81), 40);
});

test("getNameWidth leaves the browser row frame and the panel aside", () => {
    assert.equal(getNameWidth(100), 42);
    assert.equal(getNameWidth(200), 140);
});

test("getLogWidth leaves room for the log pane border and padding", () => {
    assert.equal(getLogWidth(120), 116);
});
