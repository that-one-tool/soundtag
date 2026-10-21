import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import { LogPane } from "../../../src/tui/components/log-pane.js";
import { LogBuffer } from "../../../src/tui/log-buffer.js";

afterEach(() => cleanup());

const FOLLOWING = { anchorId: null, focused: false, width: 40 };

test("LogPane keeps blank lines between log lines", () => {
    const logBuffer = new LogBuffer();
    logBuffer.info("first\n\nsecond");

    const frame = render(
        createElement(LogPane, { logBuffer, height: 5, ...FOLLOWING })
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
        createElement(LogPane, { logBuffer, height: 3, ...FOLLOWING })
    ).lastFrame();

    const lines = (frame ?? "").split("\n");
    assert.match(lines[1], /first/);
    assert.match(lines[2], /second/);
    assert.match(lines[3], /third/);
});

test("LogPane titles its border and counts the lines below a scrolled view", () => {
    const logBuffer = new LogBuffer();
    logBuffer.info("one\ntwo\nthree\nfour");
    const props = { logBuffer, height: 2, width: 40, focused: true };

    const scrolled = render(createElement(LogPane, { ...props, anchorId: 1 }));
    const following = render(
        createElement(LogPane, { ...props, anchorId: null })
    );

    const [scrolledTop] = (scrolled.lastFrame() ?? "").split("\n");
    const [followingTop] = (following.lastFrame() ?? "").split("\n");
    assert.match(scrolledTop, /╭.*Log ↑2.*╮/);
    assert.match(followingTop, /╭.*Log.*╮/);
    assert.doesNotMatch(followingTop, /↑/);
    assert.ok((scrolled.lastFrame() ?? "").includes("two"));
});

test("LogPane wraps a long line instead of cutting it", () => {
    const logBuffer = new LogBuffer();
    logBuffer.info(`  search ${"Service ✓ 0.1s · ".repeat(4)}Last ✗ HTTP 500`);

    const frame = render(
        createElement(LogPane, { logBuffer, height: 5, ...FOLLOWING })
    ).lastFrame();

    assert.match(frame ?? "", /Last ✗ HTTP 500/);
});
