import assert from "node:assert/strict";
import { test } from "node:test";
import { ToggleSetting } from "../../src/tui/toggle-setting.js";

test("ToggleSetting starts from the given choice", () => {
    assert.equal(new ToggleSetting(true).getSnapshot(), true);
    assert.equal(new ToggleSetting(false).getSnapshot(), false);
});

test("ToggleSetting toggles and notifies its listeners", () => {
    const setting = new ToggleSetting(true);
    let notifications = 0;
    setting.subscribe(() => notifications++);

    setting.toggle();
    assert.equal(setting.getSnapshot(), false);
    setting.toggle();

    assert.equal(setting.getSnapshot(), true);
    assert.equal(notifications, 2);
});
