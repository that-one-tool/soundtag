import assert from "node:assert/strict";
import { test } from "node:test";
import { SubfolderSetting } from "../../src/tui/subfolder-setting.js";

test("SubfolderSetting starts from the given choice", () => {
    assert.equal(new SubfolderSetting(true).getSnapshot(), true);
    assert.equal(new SubfolderSetting(false).getSnapshot(), false);
});

test("SubfolderSetting toggles and notifies its listeners", () => {
    const setting = new SubfolderSetting(true);
    let notifications = 0;
    setting.subscribe(() => notifications++);

    setting.toggle();
    assert.equal(setting.getSnapshot(), false);
    setting.toggle();

    assert.equal(setting.getSnapshot(), true);
    assert.equal(notifications, 2);
});
