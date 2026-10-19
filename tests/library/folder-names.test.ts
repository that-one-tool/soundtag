import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import {
    FolderNameCache,
    isSameFilename,
} from "../../src/library/folder-names.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-folder-names-test-"
);

test("isSameFilename ignores letter case and Unicode normalization", () => {
    assert.equal(
        isSameFilename("artist - title.mp3", "Artist - Title.MP3"),
        true
    );
    assert.equal(isSameFilename("Bjo\u0308rk.mp3", "Bj\u00f6rk.mp3"), true);
    assert.equal(isSameFilename("01 Title.mp3", "Artist - Title.mp3"), false);
});

test("isTaken matches names ignoring case and counts dangling symlinks", async () => {
    const directory = await createTemporaryDirectory();
    await fs.writeFile(path.join(directory, "artist - title.mp3"), "x");
    await fs.symlink(
        path.join(directory, "missing"),
        path.join(directory, "link.mp3")
    );
    const folderNames = new FolderNameCache([]);

    assert.equal(
        await folderNames.isTaken(path.join(directory, "Artist - Title.mp3")),
        true
    );
    assert.equal(
        await folderNames.isTaken(path.join(directory, "link.mp3")),
        true
    );
    assert.equal(
        await folderNames.isTaken(path.join(directory, "free.mp3")),
        false
    );
});

test("isTaken reads each folder once until it is cleared", async () => {
    const directory = await createTemporaryDirectory();
    const target = path.join(directory, "later.mp3");
    const folderNames = new FolderNameCache([]);

    assert.equal(await folderNames.isTaken(target), false);
    await fs.writeFile(path.join(directory, "LATER.mp3"), "x");
    assert.equal(await folderNames.isTaken(target), false);

    folderNames.clear();
    assert.equal(await folderNames.isTaken(target), true);
});

test("isTaken sees a file created at the exact path after the folder was read", async () => {
    const directory = await createTemporaryDirectory();
    const target = path.join(directory, "later.mp3");
    const folderNames = new FolderNameCache([]);
    assert.equal(await folderNames.isTaken(target), false);

    await fs.writeFile(target, "x");

    assert.equal(await folderNames.isTaken(target), true);
});

test("recordRename keeps a name taken while a case twin still holds it", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "a - b.mp3");
    await fs.writeFile(source, "x");
    await fs.writeFile(path.join(directory, "A - B.mp3"), "y");
    const folderNames = new FolderNameCache([source]);
    const destination = path.join(directory, "X - Y.mp3");
    assert.equal(await folderNames.isTaken(destination), false);
    await fs.rename(source, destination);

    folderNames.recordRename(source, destination);

    assert.equal(
        await folderNames.isTaken(path.join(directory, "a - B.mp3")),
        true
    );
});

test("recordRename frees the old name and takes the new one", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "old.mp3");
    const destination = path.join(directory, "new.mp3");
    await fs.writeFile(source, "x");
    const folderNames = new FolderNameCache([source]);
    assert.equal(await folderNames.isTaken(destination), false);
    await fs.rename(source, destination);

    folderNames.recordRename(source, destination);

    assert.equal(await folderNames.isTaken(source), false);
    assert.equal(await folderNames.isTaken(destination), true);
});

test("markProcessed drops a folder once its last file is processed", async () => {
    const directory = await createTemporaryDirectory();
    const files = ["a.mp3", "b.mp3"].map((name) => path.join(directory, name));
    const target = path.join(directory, "later.mp3");
    const folderNames = new FolderNameCache(files);
    assert.equal(await folderNames.isTaken(target), false);
    await fs.writeFile(path.join(directory, "LATER.mp3"), "x");

    folderNames.markProcessed(files[0]);
    assert.equal(await folderNames.isTaken(target), false);

    folderNames.markProcessed(files[1]);
    assert.equal(await folderNames.isTaken(target), true);
});

test("recordRename and markProcessed ignore folders the cache does not know", async () => {
    const directory = await createTemporaryDirectory();
    const target = path.join(directory, "new.mp3");
    const folderNames = new FolderNameCache([]);

    folderNames.recordRename(path.join(directory, "old.mp3"), target);
    folderNames.markProcessed(path.join(directory, "old.mp3"));

    assert.equal(await folderNames.isTaken(target), false);
});

test("recordRename adds the new name to the destination folder", async () => {
    const sourceDirectory = await createTemporaryDirectory();
    const destinationDirectory = await createTemporaryDirectory();
    const source = path.join(sourceDirectory, "old.mp3");
    const destination = path.join(destinationDirectory, "new.mp3");
    const folderNames = new FolderNameCache([]);
    assert.equal(await folderNames.isTaken(source), false);
    assert.equal(await folderNames.isTaken(destination), false);

    folderNames.recordRename(source, destination);

    assert.equal(
        await folderNames.isTaken(path.join(destinationDirectory, "NEW.mp3")),
        true
    );
});
