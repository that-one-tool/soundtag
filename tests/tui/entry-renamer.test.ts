import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import type { PathMove } from "../../src/shared/paths.js";
import { EntryRenamer } from "../../src/tui/entry-renamer.js";
import { PathMoves } from "../../src/tui/path-moves.js";
import { startRenameDraft } from "../../src/tui/rename-draft.js";
import { TaggingQueue } from "../../src/tui/tagging-queue.js";
import type { BrowserEntry } from "../../src/tui/types.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";
import { DEFAULT_JOB_SETTINGS } from "../helpers/tui.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-entry-renamer-test-"
);

async function createSong(): Promise<BrowserEntry> {
    const directory = await createTemporaryDirectory();
    const song = path.join(directory, "old.mp3");
    await fs.writeFile(song, "audio");
    return { name: "old.mp3", path: song, kind: "file" };
}

function createRenamer() {
    const logger = createRecordingLogger();
    const queue = new TaggingQueue(() => new Promise(() => {}), logger);
    const pathMoves = new PathMoves();
    const moves: PathMove[] = [];
    pathMoves.subscribe((move) => moves.push(move));
    const renamer = new EntryRenamer({ queue, pathMoves, logger });
    return { renamer, queue, logger, moves };
}

async function renameTo(
    renamer: EntryRenamer,
    entry: BrowserEntry,
    text: string
): Promise<void> {
    const draft = startRenameDraft(entry)!;
    await renamer.rename({ ...draft, field: { text, caret: text.length } });
}

test("EntryRenamer renames the entry and records the move", async () => {
    const song = await createSong();
    const { renamer, logger, moves } = createRenamer();

    await renameTo(renamer, song, "new");

    const destination = path.join(path.dirname(song.path), "new.mp3");
    await fs.access(destination);
    assert.deepEqual(moves, [{ source: song.path, destination }]);
    assert.deepEqual(logger.infos, ["Renamed old.mp3 to new.mp3."]);
});

test("EntryRenamer does nothing when the name is unchanged", async () => {
    const song = await createSong();
    const { renamer, logger, moves } = createRenamer();

    await renameTo(renamer, song, "old");

    assert.deepEqual(moves, []);
    assert.deepEqual([...logger.infos, ...logger.errors], []);
});

test("EntryRenamer refuses invalid names", async () => {
    const song = await createSong();
    const { renamer, logger, moves } = createRenamer();

    for (const text of [" ", "a/b", ".hidden"]) {
        await renameTo(renamer, song, text);
    }

    await fs.access(song.path);
    assert.deepEqual(moves, []);
    assert.deepEqual(logger.errors, [
        "Not renamed: the name is empty.",
        "Not renamed: a name cannot contain /.",
        "Not renamed: a name starting with a dot would be hidden.",
    ]);
});

test("EntryRenamer refuses entries the tagging queue works on", async () => {
    const song = await createSong();
    const { renamer, queue, logger, moves } = createRenamer();
    queue.enqueue({
        kind: "file",
        settings: DEFAULT_JOB_SETTINGS,
        path: song.path,
    });

    await renameTo(renamer, song, "new");

    await fs.access(song.path);
    assert.deepEqual(moves, []);
    assert.deepEqual(logger.errors, [
        "Not renamed: old.mp3 is queued for tagging.",
    ]);
});

test("EntryRenamer keeps an existing entry with the new name", async () => {
    const song = await createSong();
    const taken = path.join(path.dirname(song.path), "taken.mp3");
    await fs.writeFile(taken, "taken");
    const { renamer, logger, moves } = createRenamer();

    await renameTo(renamer, song, "taken");

    assert.equal(await fs.readFile(taken, "utf8"), "taken");
    assert.deepEqual(moves, []);
    assert.deepEqual(logger.infos, ["Not renamed: taken.mp3 already exists."]);
});

test("EntryRenamer logs a failed rename", async () => {
    const song = await createSong();
    await fs.rm(song.path);
    const { renamer, logger, moves } = createRenamer();

    await renameTo(renamer, song, "new");

    assert.deepEqual(moves, []);
    assert.equal(logger.errors.length, 1);
    assert.match(logger.errors[0], /^Rename error: .*ENOENT/);
});

test("EntryRenamer refuses a folder holding a queued file", async () => {
    const song = await createSong();
    const folder = path.dirname(song.path);
    const { renamer, queue, logger } = createRenamer();
    queue.enqueue({
        kind: "file",
        settings: DEFAULT_JOB_SETTINGS,
        path: path.join(folder, "other.mp3"),
    });
    queue.enqueue({
        kind: "file",
        settings: DEFAULT_JOB_SETTINGS,
        path: song.path,
    });
    const entry: BrowserEntry = {
        name: path.basename(folder),
        path: folder,
        kind: "folder",
    };

    await renameTo(renamer, entry, "Renamed");

    await fs.access(folder);
    assert.match(logger.errors[0], /is queued for tagging\.$/);
});

test("EntryRenamer starts a draft only for an entry the queue leaves alone", async () => {
    const song = await createSong();
    const { renamer, queue, logger } = createRenamer();

    assert.equal(renamer.startDraft(song)?.field.text, "old");
    queue.enqueue({
        kind: "file",
        settings: DEFAULT_JOB_SETTINGS,
        path: song.path,
    });

    assert.equal(renamer.startDraft(song), null);
    assert.equal(renamer.startDraft(undefined), null);
    const parent: BrowserEntry = {
        name: "..",
        path: path.dirname(song.path),
        kind: "parent",
    };
    assert.equal(renamer.startDraft(parent), null);
    assert.deepEqual(logger.errors, [
        "Not renamed: old.mp3 is queued for tagging.",
    ]);
});
