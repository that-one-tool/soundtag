import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import { LogPane } from "../../../src/tui/components/log-pane.js";
import { LogBuffer } from "../../../src/tui/log-buffer.js";

afterEach(() => cleanup());

test("LogPane keeps blank lines between log lines", () => {
    const logBuffer = new LogBuffer();
    logBuffer.info("first\n\nsecond");

    const frame = render(
        createElement(LogPane, { logBuffer, height: 5 })
    ).lastFrame();

    const lines = (frame ?? "").split("\n");
    const firstIndex = lines.findIndex((line) => line.includes("first"));
    assert.match(lines[firstIndex + 1], /^│\s+│$/);
    assert.match(lines[firstIndex + 2], /second/);
});

test("LogPane shows an older line instead of a leading blank one", () => {
    const logBuffer = new LogBuffer();
    logBuffer.info("first\n\nsecond\nthird");

    const frame = render(
        createElement(LogPane, { logBuffer, height: 3 })
    ).lastFrame();

    const lines = (frame ?? "").split("\n");
    assert.match(lines[1], /first/);
    assert.match(lines[2], /second/);
    assert.match(lines[3], /third/);
});
