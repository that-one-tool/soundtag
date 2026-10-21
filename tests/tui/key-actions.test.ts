import assert from "node:assert/strict";
import { test } from "node:test";
import type { Key } from "ink";
import { getKeyAction } from "../../src/tui/key-actions.js";

function key(overrides: Partial<Key> = {}): Key {
    return { ...({} as Key), ...overrides };
}

test("getKeyAction maps navigation keys", () => {
    assert.equal(getKeyAction("", key({ upArrow: true })), "moveUp");
    assert.equal(getKeyAction("", key({ downArrow: true })), "moveDown");
    assert.equal(getKeyAction("", key({ pageUp: true })), "pageUp");
    assert.equal(getKeyAction("", key({ pageDown: true })), "pageDown");
    assert.equal(getKeyAction("", key({ return: true })), "open");
    assert.equal(getKeyAction("", key({ rightArrow: true })), "open");
    assert.equal(getKeyAction("", key({ leftArrow: true })), "parent");
    assert.equal(getKeyAction("", key({ backspace: true })), "parent");
    assert.equal(getKeyAction("", key({ delete: true })), "parent");
});

test("getKeyAction maps command keys", () => {
    assert.equal(getKeyAction("t", key()), "tag");
    assert.equal(getKeyAction("a", key()), "tagFolder");
    assert.equal(getKeyAction("s", key()), "stop");
    assert.equal(getKeyAction("r", key()), "toggleSubfolders");
    assert.equal(getKeyAction("n", key()), "toggleRenaming");
    assert.equal(getKeyAction("f", key()), "toggleFixing");
    assert.equal(getKeyAction("e", key()), "rename");
    assert.equal(getKeyAction("D", key({ shift: true })), "clearTags");
    assert.equal(getKeyAction("y", key()), "confirmClear");
    assert.equal(getKeyAction("Y", key({ shift: true })), "confirmClear");
    assert.equal(getKeyAction("q", key()), "quit");
    assert.equal(getKeyAction("c", key({ ctrl: true })), "quit");
    assert.equal(getKeyAction("", key({ tab: true })), "toggleFocus");
});

test("getKeyAction ignores other keys", () => {
    assert.equal(getKeyAction("x", key()), undefined);
    assert.equal(getKeyAction("d", key()), undefined);
    assert.equal(getKeyAction("c", key()), undefined);
});
