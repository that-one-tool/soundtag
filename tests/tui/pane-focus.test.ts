import assert from "node:assert/strict";
import { test } from "node:test";
import { PaneFocus } from "../../src/tui/pane-focus.js";

test("PaneFocus starts on the browser", () => {
    assert.equal(new PaneFocus().getSnapshot(), "browser");
});

test("PaneFocus toggles between the panes and notifies its listeners", () => {
    const focus = new PaneFocus();
    let notifications = 0;
    focus.subscribe(() => notifications++);

    focus.toggle();
    assert.equal(focus.getSnapshot(), "log");
    focus.toggle();

    assert.equal(focus.getSnapshot(), "browser");
    assert.equal(notifications, 2);
});
