import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { getEntryDot } from "../../src/tui/entry-dot.js";
import type {
    BrowserEntry,
    DotSources,
    QueueState,
    TagTarget,
} from "../../src/tui/types.js";
import { DEFAULT_JOB_SETTINGS } from "../helpers/tui.js";

const root = path.resolve("music");
const rock = path.join(root, "Rock");
const live = path.join(rock, "Live");
const song = path.join(rock, "song.mp3");
const other = path.join(rock, "other.mp3");
const rockTarget: TagTarget = {
    kind: "folder",
    settings: DEFAULT_JOB_SETTINGS,
    path: rock,
    recursive: true,
};

function file(filePath: string): BrowserEntry {
    return { name: path.basename(filePath), path: filePath, kind: "file" };
}

function folder(folderPath: string): BrowserEntry {
    return {
        name: path.basename(folderPath),
        path: folderPath,
        kind: "folder",
    };
}

function makeSources(
    queue: Partial<QueueState>,
    redoneFiles: string[] = []
): DotSources {
    return {
        queue: {
            running: null,
            pending: [],
            stopping: false,
            failed: false,
            ...queue,
        },
        statuses: new Map([[song, "TAGGED"]]),
        redoneFiles: new Set(redoneFiles),
    };
}

test("getEntryDot shows the status when nothing is queued", () => {
    const idle = makeSources({});

    assert.equal(getEntryDot(idle, file(song)), "TAGGED");
    assert.equal(getEntryDot(idle, file(other)), undefined);
});

test("getEntryDot marks pending entries as queued over their status", () => {
    const sources = makeSources({ pending: [rockTarget] });

    assert.equal(getEntryDot(sources, file(song)), "QUEUED");
    assert.equal(getEntryDot(sources, folder(rock)), "QUEUED");
    assert.equal(getEntryDot(sources, folder(root)), "QUEUED");
});

test("getEntryDot shows the status of files the running job has redone", () => {
    const sources = makeSources({ running: rockTarget }, [song]);

    assert.equal(getEntryDot(sources, file(song)), "TAGGED");
    assert.equal(getEntryDot(sources, file(other)), "QUEUED");
    assert.equal(getEntryDot(sources, folder(rock)), "QUEUED");
    assert.equal(getEntryDot(sources, folder(root)), "QUEUED");
});

test("getEntryDot marks old statuses of the running job as queued", () => {
    const sources = makeSources({ running: rockTarget });

    assert.equal(getEntryDot(sources, file(song)), "QUEUED");
});

test("getEntryDot lets a pending target win over a redone status", () => {
    const pendingSong: TagTarget = {
        kind: "file",
        settings: DEFAULT_JOB_SETTINGS,
        path: song,
    };
    const sources = makeSources(
        { running: rockTarget, pending: [pendingSong] },
        [song]
    );

    assert.equal(getEntryDot(sources, file(song)), "QUEUED");
});

test("getEntryDot leaves subfolders of a flat running folder alone", () => {
    const flat: TagTarget = {
        kind: "folder",
        settings: DEFAULT_JOB_SETTINGS,
        path: rock,
        recursive: false,
    };
    const sources = makeSources({ running: flat });

    assert.equal(getEntryDot(sources, folder(live)), undefined);
    assert.equal(
        getEntryDot(sources, file(path.join(live, "a.mp3"))),
        undefined
    );
});

test("getEntryDot keeps the status of entries outside the queue", () => {
    const elsewhere = path.join(root, "Jazz", "a.mp3");
    const sources = makeSources({
        pending: [
            { kind: "file", path: elsewhere, settings: DEFAULT_JOB_SETTINGS },
        ],
    });

    assert.equal(getEntryDot(sources, file(song)), "TAGGED");
    const parent: BrowserEntry = { name: "..", path: root, kind: "parent" };
    assert.equal(getEntryDot(sources, parent), undefined);
});
