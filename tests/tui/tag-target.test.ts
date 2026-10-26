import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { isEntryTargeted } from "../../src/tui/tag-target.js";
import type { BrowserEntry, TagTarget } from "../../src/tui/types.js";
import { DEFAULT_JOB_SETTINGS } from "../helpers/tui.js";

const root = path.resolve("music");
const rock = path.join(root, "Rock");
const live = path.join(rock, "Live");
const song = path.join(rock, "song.mp3");
const liveSong = path.join(live, "live.mp3");

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

const fileTarget: TagTarget = {
    kind: "file",
    settings: DEFAULT_JOB_SETTINGS,
    path: song,
};
const flatFolder: TagTarget = {
    kind: "folder",
    settings: DEFAULT_JOB_SETTINGS,
    path: rock,
    recursive: false,
};
const deepFolder: TagTarget = {
    kind: "folder",
    settings: DEFAULT_JOB_SETTINGS,
    path: rock,
    recursive: true,
};

test("isEntryTargeted matches a file target only on its own path", () => {
    assert.equal(isEntryTargeted(fileTarget, file(song)), true);
    assert.equal(
        isEntryTargeted(fileTarget, file(path.join(rock, "b.mp3"))),
        false
    );
});

test("isEntryTargeted reaches subfolder files only for recursive folders", () => {
    assert.equal(isEntryTargeted(flatFolder, file(song)), true);
    assert.equal(isEntryTargeted(flatFolder, file(liveSong)), false);
    assert.equal(isEntryTargeted(deepFolder, file(liveSong)), true);
    assert.equal(
        isEntryTargeted(deepFolder, file(path.join(root, "a.mp3"))),
        false
    );
});

test("isEntryTargeted marks the target and the folders holding it", () => {
    assert.equal(isEntryTargeted(fileTarget, file(song)), true);
    assert.equal(isEntryTargeted(fileTarget, folder(rock)), true);
    assert.equal(isEntryTargeted(fileTarget, folder(root)), true);
    assert.equal(isEntryTargeted(fileTarget, folder(live)), false);
    assert.equal(isEntryTargeted(flatFolder, folder(rock)), true);
});

test("isEntryTargeted reaches subfolders only for recursive folders", () => {
    assert.equal(isEntryTargeted(flatFolder, folder(live)), false);
    assert.equal(isEntryTargeted(deepFolder, folder(live)), true);
    assert.equal(isEntryTargeted(deepFolder, file(liveSong)), true);
});

test("isEntryTargeted never marks the parent link", () => {
    const parent: BrowserEntry = { name: "..", path: root, kind: "parent" };

    assert.equal(isEntryTargeted(deepFolder, parent), false);
});
