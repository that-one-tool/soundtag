import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import {
    countFolderStatuses,
    countStatuses,
    getEntryStatus,
    recordProcessedTrack,
} from "../../src/tui/track-statuses.js";
import { TrackStatusStore } from "../../src/tui/track-status-store.js";
import type { BrowserEntry } from "../../src/tui/types.js";

const root = path.resolve("music");
const rock = path.join(root, "Rock");
const song = path.join(rock, "song.mp3");

function folder(folderPath: string): BrowserEntry {
    return {
        name: path.basename(folderPath),
        path: folderPath,
        kind: "folder",
    };
}

function file(filePath: string): BrowserEntry {
    return { name: path.basename(filePath), path: filePath, kind: "file" };
}

test("recordProcessedTrack stores the status under the file path", () => {
    const statuses = recordProcessedTrack(new Map(), {
        source: song,
        status: "TAGGED",
        destination: null,
    });

    assert.equal(getEntryStatus(statuses, file(song)), "TAGGED");
});

test("recordProcessedTrack moves the status to the renamed path", () => {
    const renamed = path.join(rock, "Artist - Title.mp3");
    const statuses = recordProcessedTrack(new Map(), {
        source: song,
        status: "SKIPPED",
        destination: renamed,
    });

    assert.deepEqual([...statuses], [[renamed, "SKIPPED"]]);
});

test("recordProcessedTrack leaves the previous map untouched", () => {
    const previous = new Map();

    recordProcessedTrack(previous, {
        source: song,
        status: "TAGGED",
        destination: null,
    });

    assert.equal(previous.size, 0);
});

test("getEntryStatus gives a folder the worst status found inside it", () => {
    const statuses = new Map([
        [path.join(rock, "a.mp3"), "TAGGED" as const],
        [path.join(rock, "Live", "b.mp3"), "SKIPPED" as const],
    ]);

    assert.equal(getEntryStatus(statuses, folder(rock)), "SKIPPED");
    assert.equal(getEntryStatus(statuses, folder(root)), "SKIPPED");

    const withFailure = new Map([
        ...statuses,
        [path.join(rock, "c.mp3"), "FAILED" as const],
    ]);
    assert.equal(getEntryStatus(withFailure, folder(rock)), "FAILED");
});

test("getEntryStatus ignores sibling folders sharing a name prefix", () => {
    const statuses = new Map([
        [path.join(root, "Rockabilly", "a.mp3"), "FAILED" as const],
    ]);

    assert.equal(getEntryStatus(statuses, folder(rock)), undefined);
});

test("getEntryStatus finds statuses below the filesystem root", () => {
    const filesystemRoot = path.parse(root).root;
    const statuses = new Map([[song, "TAGGED" as const]]);

    assert.equal(getEntryStatus(statuses, folder(filesystemRoot)), "TAGGED");
});

test("getEntryStatus has no status for untouched entries or the parent link", () => {
    const statuses = new Map([[song, "TAGGED" as const]]);

    assert.equal(
        getEntryStatus(statuses, file(path.join(rock, "x.mp3"))),
        undefined
    );
    assert.equal(
        getEntryStatus(statuses, { name: "..", path: root, kind: "parent" }),
        undefined
    );
});

test("countFolderStatuses counts each status inside a folder", () => {
    const statuses = new Map([
        [path.join(rock, "a.mp3"), "TAGGED" as const],
        [path.join(rock, "b.mp3"), "TAGGED" as const],
        [path.join(rock, "c.mp3"), "FAILED" as const],
        [path.join(root, "Jazz", "d.mp3"), "SKIPPED" as const],
    ]);

    assert.deepEqual(countFolderStatuses(statuses, rock), {
        TAGGED: 2,
        SKIPPED: 0,
        FAILED: 1,
    });
});

test("countStatuses counts each status of the session", () => {
    const statuses = new Map([
        [path.join(rock, "a.mp3"), "TAGGED" as const],
        [path.join(root, "Jazz", "d.mp3"), "SKIPPED" as const],
    ]);

    assert.deepEqual(countStatuses(statuses), {
        TAGGED: 1,
        SKIPPED: 1,
        FAILED: 0,
    });
});

test("TrackStatusStore notifies subscribers with a new snapshot", () => {
    const store = new TrackStatusStore();
    const before = store.getSnapshot();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);

    store.record({ source: song, status: "FAILED", destination: null });
    unsubscribe();
    store.record({ source: song, status: "TAGGED", destination: null });

    assert.equal(notifications, 1);
    assert.notEqual(store.getSnapshot(), before);
    assert.equal(store.getSnapshot().get(song), "TAGGED");
});
