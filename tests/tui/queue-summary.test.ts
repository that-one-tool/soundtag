import assert from "node:assert/strict";
import { test } from "node:test";
import { describeQueue, describeTarget } from "../../src/tui/queue-summary.js";
import type { QueueState } from "../../src/tui/types.js";
import { RENAMING_ON } from "../helpers/tui.js";

const idle: QueueState = {
    running: null,
    pending: [],
    stopping: false,
    failed: false,
};
const running: QueueState = {
    ...idle,
    running: {
        kind: "folder",
        path: "/music/Album",
        recursive: true,
        settings: RENAMING_ON,
    },
};

test("describeQueue reports an idle queue", () => {
    assert.equal(describeQueue(idle, false), "Idle");
});

test("describeQueue names the running target and counts queued ones", () => {
    assert.equal(describeQueue(running, false), "Tagging Album");
    assert.equal(
        describeQueue(
            {
                ...running,
                pending: [
                    { kind: "file", path: "/a.mp3", settings: RENAMING_ON },
                ],
            },
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

test("describeTarget names a file, or a folder with its subfolder choice", () => {
    assert.equal(
        describeTarget({ kind: "file", path: "/a.mp3", settings: RENAMING_ON }),
        "a.mp3"
    );
    assert.equal(
        describeTarget({
            kind: "folder",
            path: "/Rock",
            recursive: true,
            settings: RENAMING_ON,
        }),
        "Rock (subfolders on)"
    );
    assert.equal(
        describeTarget({
            kind: "folder",
            path: "/Rock",
            recursive: false,
            settings: RENAMING_ON,
        }),
        "Rock (subfolders off)"
    );
});

test("describeTarget tells when a target keeps its names", () => {
    const keepNames = { renameFiles: false };

    assert.equal(
        describeTarget({ kind: "file", path: "/a.mp3", settings: keepNames }),
        "a.mp3 (renaming off)"
    );
    assert.equal(
        describeTarget({
            kind: "folder",
            path: "/Rock",
            recursive: true,
            settings: keepNames,
        }),
        "Rock (subfolders on, renaming off)"
    );
});
