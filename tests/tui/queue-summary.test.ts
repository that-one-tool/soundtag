import assert from "node:assert/strict";
import { test } from "node:test";
import { describeQueue, describeTarget } from "../../src/tui/queue-summary.js";
import type { QueueState } from "../../src/tui/types.js";
import { DEFAULT_JOB_SETTINGS } from "../helpers/tui.js";

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
        settings: DEFAULT_JOB_SETTINGS,
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
                    {
                        kind: "file",
                        path: "/a.mp3",
                        settings: DEFAULT_JOB_SETTINGS,
                    },
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
        describeTarget({
            kind: "file",
            path: "/a.mp3",
            settings: DEFAULT_JOB_SETTINGS,
        }),
        "a.mp3"
    );
    assert.equal(
        describeTarget({
            kind: "folder",
            path: "/Rock",
            recursive: true,
            settings: DEFAULT_JOB_SETTINGS,
        }),
        "Rock (subfolders on)"
    );
    assert.equal(
        describeTarget({
            kind: "folder",
            path: "/Rock",
            recursive: false,
            settings: DEFAULT_JOB_SETTINGS,
        }),
        "Rock (subfolders off)"
    );
});

test("describeTarget tells when a target renames files and folders", () => {
    const renameNames = {
        renameFiles: true,
        fixTags: false,
        replaceCovers: false,
        coversOnly: false,
    };

    assert.equal(
        describeTarget({ kind: "file", path: "/a.mp3", settings: renameNames }),
        "a.mp3 (renaming on)"
    );
    assert.equal(
        describeTarget({
            kind: "folder",
            path: "/Rock",
            recursive: true,
            settings: renameNames,
        }),
        "Rock (subfolders on, renaming on)"
    );
});

test("describeTarget tells when a target fixes existing tags", () => {
    assert.equal(
        describeTarget({
            kind: "file",
            path: "/a.mp3",
            settings: {
                renameFiles: false,
                fixTags: true,
                replaceCovers: false,
                coversOnly: false,
            },
        }),
        "a.mp3 (fixing on)"
    );
});

test("describeTarget tells when a target only tags covers", () => {
    assert.equal(
        describeTarget({
            kind: "file",
            path: "/a.mp3",
            settings: { ...DEFAULT_JOB_SETTINGS, coversOnly: true },
        }),
        "a.mp3 (covers only on)"
    );
});

test("describeTarget tells when a target replaces existing covers", () => {
    assert.equal(
        describeTarget({
            kind: "file",
            path: "/a.mp3",
            settings: { ...DEFAULT_JOB_SETTINGS, replaceCovers: true },
        }),
        "a.mp3 (replacing covers on)"
    );
});
