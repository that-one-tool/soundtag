import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { getTagStore } from "../../src/tags/audio-tags.js";
import { TagClearer } from "../../src/tui/tag-clearer.js";
import { TaggingQueue } from "../../src/tui/tagging-queue.js";
import { TrackStatusStore } from "../../src/tui/track-status-store.js";
import type { BrowserEntry } from "../../src/tui/types.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";
import { DEFAULT_JOB_SETTINGS } from "../helpers/tui.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-tag-clearer-test-"
);

async function createTaggedSong(): Promise<BrowserEntry> {
    const directory = await createTemporaryDirectory();
    const song = path.join(directory, "song.mp3");
    await fs.writeFile(song, "audio");
    await getTagStore(song).write(song, {
        info: { title: "Title", artist: "Artist", album: "", year: "" },
        extras: {},
        coverData: null,
    });
    return { name: "song.mp3", path: song, kind: "file" };
}

function createClearer() {
    const logger = createRecordingLogger();
    const queue = new TaggingQueue(() => new Promise(() => {}), logger);
    const statusStore = new TrackStatusStore();
    const clearer = new TagClearer({ queue, logger, statusStore });
    return { clearer, queue, logger, statusStore };
}

async function readTitle(song: BrowserEntry): Promise<string> {
    return (await getTagStore(song.path).read(song.path)).info.title;
}

test("TagClearer asks for confirmation before clearing", async () => {
    const song = await createTaggedSong();
    const { clearer, logger } = createClearer();

    clearer.request(song);

    assert.equal(await readTitle(song), "Title");
    assert.deepEqual(logger.infos, ["Press y to clear all tags of song.mp3."]);
});

test("TagClearer clears the tags once confirmed", async () => {
    const song = await createTaggedSong();
    const { clearer, logger } = createClearer();
    const revision = clearer.getSnapshot();
    let notified = false;
    clearer.subscribe(() => (notified = true));

    clearer.request(song);
    await clearer.confirm(song);

    assert.equal(await readTitle(song), "");
    assert.equal(logger.infos.at(-1), "Cleared all tags of song.mp3.");
    assert.ok(notified);
    assert.notEqual(clearer.getSnapshot(), revision);
});

test("TagClearer forgets the session status of a cleared file", async () => {
    const song = await createTaggedSong();
    const { clearer, statusStore } = createClearer();
    statusStore.record({
        source: song.path,
        status: "TAGGED",
        destination: null,
    });

    clearer.request(song);
    await clearer.confirm(song);

    assert.equal(statusStore.getSnapshot().has(song.path), false);
});

test("TagClearer ignores a confirmation without a request", async () => {
    const song = await createTaggedSong();
    const { clearer, logger } = createClearer();

    await clearer.confirm(song);

    assert.deepEqual([...logger.infos, ...logger.errors], []);
});

test("TagClearer clears once per confirmed request", async () => {
    const song = await createTaggedSong();
    const { clearer, logger } = createClearer();

    clearer.request(song);
    await clearer.confirm(song);
    await clearer.confirm(song);

    assert.equal(logger.infos.length, 2);
});

test("TagClearer ignores a confirmation once disarmed", async () => {
    const song = await createTaggedSong();
    const { clearer } = createClearer();

    clearer.request(song);
    clearer.disarm();
    await clearer.confirm(song);

    assert.equal(await readTitle(song), "Title");
});

test("TagClearer tells whether a request waits for confirmation", async () => {
    const song = await createTaggedSong();
    const { clearer } = createClearer();
    assert.equal(clearer.isArmed(), false);

    clearer.request(song);
    assert.equal(clearer.isArmed(), true);
    clearer.disarm();

    assert.equal(clearer.isArmed(), false);
});

test("TagClearer clears the file requested last", async () => {
    const song = await createTaggedSong();
    const other = await createTaggedSong();
    const { clearer } = createClearer();

    clearer.request(song);
    clearer.request(other);
    await clearer.confirm(other);

    assert.equal(await readTitle(song), "Title");
    assert.equal(await readTitle(other), "");
});

test("TagClearer clears nothing when another entry is hovered", async () => {
    const song = await createTaggedSong();
    const other = await createTaggedSong();
    const { clearer } = createClearer();

    clearer.request(song);
    await clearer.confirm(other);
    await clearer.confirm(song);

    assert.equal(await readTitle(song), "Title");
    assert.equal(await readTitle(other), "Title");
});

test("TagClearer refuses folders and missing entries", async () => {
    const { clearer, logger } = createClearer();
    const folder: BrowserEntry = { name: "Album", path: "/a", kind: "folder" };

    clearer.request(folder);
    clearer.request(undefined);

    assert.deepEqual(logger.infos, []);
    assert.deepEqual(logger.errors, [
        "Not cleared: only files have tags.",
        "Not cleared: only files have tags.",
    ]);
});

test("TagClearer refuses files the tagging queue works on", async () => {
    const song = await createTaggedSong();
    const { clearer, queue, logger } = createClearer();
    queue.enqueue({
        kind: "file",
        path: song.path,
        settings: DEFAULT_JOB_SETTINGS,
    });

    clearer.request(song);
    await clearer.confirm(song);

    assert.equal(await readTitle(song), "Title");
    assert.deepEqual(logger.errors, [
        "Not cleared: song.mp3 is queued for tagging.",
    ]);
});

test("TagClearer drops the pending request when refusing another", async () => {
    const song = await createTaggedSong();
    const { clearer } = createClearer();

    clearer.request(song);
    clearer.request(undefined);
    await clearer.confirm(song);

    assert.equal(await readTitle(song), "Title");
});

test("TagClearer logs a failed clear", async () => {
    const song = await createTaggedSong();
    const { clearer, logger } = createClearer();
    clearer.request(song);
    await fs.rm(song.path);

    await clearer.confirm(song);

    assert.match(logger.errors[0] ?? "", /^Clear error: /);
    assert.equal(clearer.isClearing(), false);
});

test("TagClearer reports a clear in progress", async () => {
    const song = await createTaggedSong();
    const { clearer } = createClearer();
    clearer.request(song);

    const clearing = clearer.confirm(song);

    assert.equal(clearer.isClearing(), true);
    await clearing;
    assert.equal(clearer.isClearing(), false);
});
