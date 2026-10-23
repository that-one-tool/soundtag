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
    assert.equal(getPanelWidth(200, 2), 52);
    assert.equal(getPanelWidth(80, 2), 40);
    assert.equal(getPanelWidth(81, 2), 40);
});

test("getPanelWidth widens for a square cover in taller cells", () => {
    assert.equal(getPanelWidth(200, 2.25), 58);
    assert.equal(getPanelWidth(200, 2.3), 60);
    assert.equal(getPanelWidth(100, 2.25), 50);
});

test("getPanelWidth keeps room for the fields in wider cells", () => {
    assert.equal(getPanelWidth(200, 1.5), 52);
});

test("getNameWidth leaves the browser row frame and the panel aside", () => {
    assert.equal(getNameWidth(100, 2), 42);
    assert.equal(getNameWidth(200, 2), 140);
    assert.equal(getNameWidth(200, 2.25), 134);
});

test("getLogWidth leaves room for the log pane border and padding", () => {
    assert.equal(getLogWidth(120), 116);
});
