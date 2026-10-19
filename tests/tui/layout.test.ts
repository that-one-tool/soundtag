import assert from "node:assert/strict";
import { test } from "node:test";
import { getLayout } from "../../src/tui/layout.js";

test("getLayout gives the log pane a third of the terminal", () => {
    assert.deepEqual(getLayout(45), { logLines: 13, listHeight: 24 });
    assert.deepEqual(getLayout(60), { logLines: 18, listHeight: 34 });
});

test("getLayout keeps six log lines on small terminals", () => {
    assert.deepEqual(getLayout(24), { logLines: 6, listHeight: 10 });
    assert.equal(getLayout(10).logLines, 6);
});

test("getLayout keeps a minimum list height", () => {
    assert.equal(getLayout(10).listHeight, 3);
});
