import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "ink-testing-library";
import { Box } from "ink";
import { createElement } from "react";
import { StatusBar } from "../../../src/tui/components/status-bar.js";

afterEach(() => cleanup());

const queueState = {
    running: null,
    pending: [],
    stopping: false,
    failed: false,
};

// Wider than the 100 columns of ink-testing-library, so no hint is cut off.
const WIDE_TERMINAL = 230;

function renderStatusBar(
    subfoldersIncluded: boolean,
    {
        renamingEnabled = true,
        fixingEnabled = false,
        coverReplacingEnabled = false,
        coversOnlyEnabled = false,
    } = {}
): string {
    const statusBar = createElement(StatusBar, {
        queueState,
        quitting: false,
        subfoldersIncluded,
        renamingEnabled,
        fixingEnabled,
        coverReplacingEnabled,
        coversOnlyEnabled,
    });
    const wideRow = createElement(Box, { width: WIDE_TERMINAL }, statusBar);
    return render(wideRow).lastFrame() ?? "";
}

test("StatusBar shows the queue state and the key hints", () => {
    const frame = renderStatusBar(true);

    assert.match(
        frame,
        /Idle · subfolders on · renaming on · fixing off · replacing covers off · covers only off/
    );
    assert.match(
        frame,
        /t tag {2}a all {2}e name {2}D clear {2}r subs {2}n names {2}f fix {2}o covers {2}c only {2}s stop {2}q quit/
    );
});

test("StatusBar shows when subfolders are excluded", () => {
    assert.match(renderStatusBar(false), /Idle · subfolders off/);
});

test("StatusBar shows when renaming is off", () => {
    assert.match(
        renderStatusBar(true, { renamingEnabled: false }),
        /subfolders on · renaming off/
    );
});

test("StatusBar shows when fixing is on", () => {
    assert.match(
        renderStatusBar(true, { fixingEnabled: true }),
        /renaming on · fixing on/
    );
});

test("StatusBar shows when only covers are tagged", () => {
    assert.match(
        renderStatusBar(true, { coversOnlyEnabled: true }),
        /replacing covers off · covers only on/
    );
});

test("StatusBar shows when covers are replaced", () => {
    assert.match(
        renderStatusBar(true, { coverReplacingEnabled: true }),
        /fixing off · replacing covers on/
    );
});
