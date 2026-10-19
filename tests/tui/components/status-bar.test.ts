import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import { StatusBar } from "../../../src/tui/components/status-bar.js";

afterEach(() => cleanup());

test("StatusBar shows the queue state and the key hints", () => {
    const queueState = {
        running: null,
        pending: [],
        stopping: false,
        failed: false,
    };

    const frame = render(
        createElement(StatusBar, { queueState, quitting: false })
    ).lastFrame();

    assert.match(frame ?? "", /Idle/);
    assert.match(
        frame ?? "",
        /t tag {2}a tag folder {2}s stop {2}d delete report {2}q quit/
    );
});
