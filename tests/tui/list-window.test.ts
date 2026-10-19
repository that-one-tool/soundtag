import assert from "node:assert/strict";
import { test } from "node:test";
import { getVisibleRange } from "../../src/tui/list-window.js";

test("getVisibleRange shows everything when the list fits", () => {
    assert.deepEqual(getVisibleRange(3, 2, 10), { start: 0, end: 3 });
});

test("getVisibleRange keeps the cursor in view near the middle", () => {
    assert.deepEqual(getVisibleRange(100, 50, 10), { start: 45, end: 55 });
});

test("getVisibleRange clamps the window at both ends", () => {
    assert.deepEqual(getVisibleRange(100, 1, 10), { start: 0, end: 10 });
    assert.deepEqual(getVisibleRange(100, 99, 10), { start: 90, end: 100 });
});

test("getVisibleRange always shows at least one row", () => {
    assert.deepEqual(getVisibleRange(5, 3, 0), { start: 3, end: 4 });
});
