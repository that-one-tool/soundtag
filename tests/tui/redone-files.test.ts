import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { RedoneFiles } from "../../src/tui/redone-files.js";

const rock = path.resolve("music", "Rock");
const song = path.join(rock, "song.mp3");

test("RedoneFiles keeps added files until cleared", () => {
    const redone = new RedoneFiles();

    redone.add(song);
    assert.deepEqual(redone.getSnapshot(), new Set([song]));

    redone.clear();
    assert.equal(redone.getSnapshot().size, 0);
});

test("RedoneFiles follows a renamed folder", () => {
    const redone = new RedoneFiles();
    redone.add(song);
    const renamed = path.resolve("music", "Artist - Album");

    redone.recordMove({ source: rock, destination: renamed });

    assert.deepEqual(
        redone.getSnapshot(),
        new Set([path.join(renamed, "song.mp3")])
    );
});

test("RedoneFiles notifies only on real changes", () => {
    const redone = new RedoneFiles();
    const before = redone.getSnapshot();
    let notifications = 0;
    redone.subscribe(() => notifications++);

    redone.clear();
    redone.add(song);
    redone.add(song);

    assert.equal(notifications, 1);
    assert.notEqual(redone.getSnapshot(), before);
});
