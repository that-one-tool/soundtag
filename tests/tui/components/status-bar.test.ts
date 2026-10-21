import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import { StatusBar } from "../../../src/tui/components/status-bar.js";

afterEach(() => cleanup());

const queueState = {
    running: null,
    pending: [],
    stopping: false,
    failed: false,
};

function renderStatusBar(subfoldersIncluded: boolean): string {
    return (
        render(
            createElement(StatusBar, {
                queueState,
                quitting: false,
                subfoldersIncluded,
            })
        ).lastFrame() ?? ""
    );
}

test("StatusBar shows the queue state and the key hints", () => {
    const frame = renderStatusBar(true);

    assert.match(frame, /Idle · subfolders on/);
    assert.match(
        frame,
        /t tag {2}a all {2}e name {2}D clear {2}r subs {2}s stop {2}q/
    );
});

test("StatusBar shows when subfolders are excluded", () => {
    assert.match(renderStatusBar(false), /Idle · subfolders off/);
});
