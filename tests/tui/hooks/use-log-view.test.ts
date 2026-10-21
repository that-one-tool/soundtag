import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Text } from "ink";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import {
    useLogView,
    type LogView,
} from "../../../src/tui/hooks/use-log-view.js";
import { LogBuffer } from "../../../src/tui/log-buffer.js";
import { waitForFrame } from "../../helpers/ink.js";

afterEach(() => cleanup());

interface ProbeProps {
    logBuffer: LogBuffer;
    height: number;
    width?: number;
    onView(view: LogView): void;
}

function LogViewProbe({ logBuffer, height, width = 80, onView }: ProbeProps) {
    const view = useLogView(logBuffer, { height, width });
    onView(view);
    return createElement(Text, null, `anchor ${view.anchorId ?? "none"}`);
}

test("useLogView follows the latest lines again after a resize and back", async () => {
    const logBuffer = new LogBuffer();
    logBuffer.info("a\nb\nc\nd\ne");
    let latest: LogView | undefined;
    const props = { logBuffer, onView: (view: LogView) => (latest = view) };
    const probe = render(createElement(LogViewProbe, { ...props, height: 2 }));

    latest?.scrollLog(-1);
    await waitForFrame(probe.lastFrame, "anchor 3");
    probe.rerender(createElement(LogViewProbe, { ...props, height: 3 }));
    await waitForFrame(probe.lastFrame, "anchor none");
    probe.rerender(createElement(LogViewProbe, { ...props, height: 2 }));

    await waitForFrame(probe.lastFrame, "anchor none");
    assert.equal(latest?.anchorId, null);
});

test("useLogView follows the latest lines again after a width change", async () => {
    const logBuffer = new LogBuffer();
    logBuffer.info("a\nb\nc\nd\ne");
    let latest: LogView | undefined;
    const props = {
        logBuffer,
        height: 2,
        onView: (view: LogView) => (latest = view),
    };
    const probe = render(createElement(LogViewProbe, props));

    latest?.scrollLog(-1);
    await waitForFrame(probe.lastFrame, "anchor 3");
    probe.rerender(createElement(LogViewProbe, { ...props, width: 60 }));

    await waitForFrame(probe.lastFrame, "anchor none");
    assert.equal(latest?.anchorId, null);
});
