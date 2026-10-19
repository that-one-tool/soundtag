import assert from "node:assert/strict";
import { test } from "node:test";
import { describeQueue } from "../../src/tui/queue-summary.js";
import type { QueueState } from "../../src/tui/types.js";

const idle: QueueState = {
    running: null,
    pending: [],
    stopping: false,
    failed: false,
};
const running: QueueState = {
    ...idle,
    running: { kind: "folder", path: "/music/Album" },
};

test("describeQueue reports an idle queue", () => {
    assert.equal(describeQueue(idle, false), "Idle");
});

test("describeQueue names the running target and counts queued ones", () => {
    assert.equal(describeQueue(running, false), "Tagging Album");
    assert.equal(
        describeQueue(
            { ...running, pending: [{ kind: "file", path: "/a.mp3" }] },
            false
        ),
        "Tagging Album · 1 queued"
    );
});

test("describeQueue tells when the run is stopping or the app quitting", () => {
    assert.equal(
        describeQueue({ ...running, stopping: true }, false),
        "Tagging Album · stopping after the current file"
    );
    assert.equal(
        describeQueue({ ...running, stopping: true }, true),
        "Tagging Album · quitting after the current file (press q again to force)"
    );
});
