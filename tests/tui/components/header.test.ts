import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "ink-testing-library";
import { Box } from "ink";
import { createElement } from "react";
import { Header } from "../../../src/tui/components/header.js";

afterEach(() => cleanup());

test("Header shows the app name and the session status counts", () => {
    const statuses = new Map([
        ["/a.mp3", "TAGGED" as const],
        ["/b.mp3", "TAGGED" as const],
        ["/c.mp3", "FAILED" as const],
    ]);

    const frame = render(createElement(Header, { statuses })).lastFrame();

    assert.match(frame ?? "", /soundtag/);
    assert.match(frame ?? "", /● 2 tagged\s+● 0 skipped\s+● 1 failed/);
});

test("Header stays on one line in a narrow terminal", () => {
    const statuses = new Map([["/a.mp3", "TAGGED" as const]]);
    const element = createElement(
        Box,
        { width: 40, flexDirection: "column" },
        createElement(Header, { statuses })
    );

    const frame = render(element).lastFrame() ?? "";

    assert.equal(frame.split("\n").length, 1);
});
