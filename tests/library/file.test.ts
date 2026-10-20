import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
    findAudioFiles,
    getAudioFormat,
    isDirectory,
    listSubfolders,
    renameIfFree,
    renameIfNameFree,
    writeTemporaryCopy,
} from "../../src/library/file.js";
import { FolderNameCache } from "../../src/library/folder-names.js";

let temporaryDirectory: string;

beforeEach(async () => {
    temporaryDirectory = await fs.mkdtemp(
        path.join(os.tmpdir(), "soundtag-file-test-")
    );
});

afterEach(async () => {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
});

test("isDirectory recognizes directories and missing paths", async () => {
    const directory = path.join(temporaryDirectory, "directory");
    await fs.mkdir(directory);

    assert.equal(await isDirectory(directory), true);
    assert.equal(
        await isDirectory(path.join(temporaryDirectory, "missing")),
        false
    );
});

test("listSubfolders returns visible subfolder names sorted", async () => {
    await fs.mkdir(path.join(temporaryDirectory, "Beta"));
    await fs.mkdir(path.join(temporaryDirectory, "Alpha"));
    await fs.mkdir(path.join(temporaryDirectory, ".hidden"));
    await fs.writeFile(path.join(temporaryDirectory, "song.mp3"), "audio");

    assert.deepEqual(await listSubfolders(temporaryDirectory), [
        "Alpha",
        "Beta",
    ]);
});

test("listSubfolders includes symlinks to folders but not to files", async () => {
    const target = path.join(temporaryDirectory, "Target");
    await fs.mkdir(target);
    await fs.writeFile(path.join(temporaryDirectory, "song.mp3"), "audio");
    await fs.symlink(target, path.join(temporaryDirectory, "Linked"));
    await fs.symlink(
        path.join(temporaryDirectory, "song.mp3"),
        path.join(temporaryDirectory, "file-link")
    );
    await fs.symlink(
        path.join(temporaryDirectory, "missing"),
        path.join(temporaryDirectory, "broken-link")
    );

    assert.deepEqual(await listSubfolders(temporaryDirectory), [
        "Linked",
        "Target",
    ]);
});

test("renameIfFree renames into a free name and never overwrites", async () => {
    const source = path.join(temporaryDirectory, "old.mp3");
    const taken = path.join(temporaryDirectory, "taken.mp3");
    const free = path.join(temporaryDirectory, "new.mp3");
    await fs.writeFile(source, "source");
    await fs.writeFile(taken, "taken");
    const folderNames = new FolderNameCache([source]);

    assert.equal(await renameIfFree(source, taken, folderNames), false);
    assert.equal(await fs.readFile(taken, "utf8"), "taken");
    assert.equal(await renameIfFree(source, free, folderNames), true);
    assert.equal(await fs.readFile(free, "utf8"), "source");
    await assert.rejects(fs.access(source));
});

test("renameIfFree records the rename so the new name stays taken", async () => {
    const first = path.join(temporaryDirectory, "first.mp3");
    const second = path.join(temporaryDirectory, "second.mp3");
    const target = path.join(temporaryDirectory, "Artist - Title.mp3");
    await fs.writeFile(first, "first");
    await fs.writeFile(second, "second");
    const folderNames = new FolderNameCache([first, second]);

    assert.equal(await renameIfFree(first, target, folderNames), true);
    assert.equal(await renameIfFree(second, target, folderNames), false);
    assert.equal(await fs.readFile(target, "utf8"), "first");
});

test("renameIfNameFree refuses a name twin and never overwrites", async () => {
    const source = path.join(temporaryDirectory, "old.mp3");
    const taken = path.join(temporaryDirectory, "Taken.mp3");
    await fs.writeFile(source, "source");
    await fs.writeFile(taken, "taken");

    const twin = path.join(temporaryDirectory, "taken.mp3");
    assert.equal(await renameIfNameFree(source, twin), false);
    assert.equal(await fs.readFile(taken, "utf8"), "taken");
    await fs.access(source);
});

test("renameIfNameFree refuses a case twin of the source itself", async () => {
    const upper = path.join(temporaryDirectory, "A.mp3");
    const lower = path.join(temporaryDirectory, "a.mp3");
    await fs.writeFile(upper, "upper");
    await fs.writeFile(lower, "lower");

    assert.equal(await renameIfNameFree(upper, lower), false);
    assert.equal(await fs.readFile(lower, "utf8"), "lower");
});

test("renameIfNameFree renames into a free or case-only changed name", async () => {
    const source = path.join(temporaryDirectory, "old song");
    const free = path.join(temporaryDirectory, "new song");
    const recased = path.join(temporaryDirectory, "New Song");
    await fs.mkdir(source);

    assert.equal(await renameIfNameFree(source, free), true);
    assert.equal(await renameIfNameFree(free, recased), true);
    assert.deepEqual(await fs.readdir(temporaryDirectory), ["New Song"]);
});

test("getAudioFormat recognizes supported extensions case-insensitively", () => {
    assert.equal(getAudioFormat("song.MP3"), "mp3");
    assert.equal(getAudioFormat("song.ogg"), "ogg");
    assert.equal(getAudioFormat("song.FLAC"), "flac");
    assert.equal(getAudioFormat("song.wav"), "wav");
    assert.equal(getAudioFormat("song"), null);
});

test("findAudioFiles filters, recurses, sorts, and respects the file limit", async () => {
    const nested = path.join(temporaryDirectory, "nested");
    await fs.mkdir(nested);
    await fs.writeFile(path.join(temporaryDirectory, "b.MP3"), "");
    await fs.writeFile(path.join(temporaryDirectory, "c.ogg"), "");
    await fs.writeFile(path.join(temporaryDirectory, "e.flac"), "");
    await fs.writeFile(path.join(temporaryDirectory, "f.wav"), "");
    await fs.writeFile(path.join(temporaryDirectory, "ignore.txt"), "");
    await fs.writeFile(path.join(temporaryDirectory, "ignore.aiff"), "");
    await fs.writeFile(path.join(nested, "a.mp3"), "");
    await fs.writeFile(path.join(nested, "d.OGG"), "");

    const recursive = await findAudioFiles(temporaryDirectory);
    assert.deepEqual(
        recursive.map((file) => path.relative(temporaryDirectory, file)),
        [
            "b.MP3",
            "c.ogg",
            "e.flac",
            "f.wav",
            path.join("nested", "a.mp3"),
            path.join("nested", "d.OGG"),
        ]
    );

    const rootOnly = await findAudioFiles(temporaryDirectory, false);
    assert.deepEqual(rootOnly, [
        path.join(temporaryDirectory, "b.MP3"),
        path.join(temporaryDirectory, "c.ogg"),
        path.join(temporaryDirectory, "e.flac"),
        path.join(temporaryDirectory, "f.wav"),
    ]);
    assert.equal((await findAudioFiles(temporaryDirectory, true, 1)).length, 1);
});

test("findAudioFiles stops walking nested folders once the limit is reached", async () => {
    const first = path.join(temporaryDirectory, "a");
    const second = path.join(temporaryDirectory, "b");
    await fs.mkdir(first);
    await fs.mkdir(second);
    await fs.writeFile(path.join(first, "1.mp3"), "");
    await fs.writeFile(path.join(first, "2.mp3"), "");
    await fs.writeFile(path.join(second, "3.mp3"), "");

    assert.deepEqual(
        (await findAudioFiles(temporaryDirectory, true, 2)).map((file) =>
            path.relative(temporaryDirectory, file)
        ),
        [path.join("a", "1.mp3"), path.join("a", "2.mp3")]
    );
});

test("findAudioFiles skips hidden files such as leftover temporary copies", async () => {
    await fs.writeFile(path.join(temporaryDirectory, "song.mp3"), "");
    await fs.writeFile(path.join(temporaryDirectory, ".song.0b6f8c1e.mp3"), "");
    await fs.writeFile(path.join(temporaryDirectory, "._song.mp3"), "");

    assert.deepEqual(
        (await findAudioFiles(temporaryDirectory)).map((file) =>
            path.basename(file)
        ),
        ["song.mp3"]
    );
});

test("findAudioFiles does not walk hidden folders", async () => {
    const hidden = path.join(temporaryDirectory, ".AppleDouble");
    await fs.mkdir(hidden);
    await fs.writeFile(path.join(hidden, "song.mp3"), "");
    await fs.writeFile(path.join(temporaryDirectory, "song.mp3"), "");

    assert.deepEqual(
        (await findAudioFiles(temporaryDirectory)).map((file) =>
            path.relative(temporaryDirectory, file)
        ),
        ["song.mp3"]
    );
});

test("findAudioFiles stops at the 3,000-file batch limit", async () => {
    await Promise.all(
        Array.from({ length: 3001 }, (_, index) =>
            fs.writeFile(
                path.join(
                    temporaryDirectory,
                    `${index.toString().padStart(4, "0")}.mp3`
                ),
                ""
            )
        )
    );

    assert.equal(
        (await findAudioFiles(temporaryDirectory, true, 3000)).length,
        3000
    );
});

test("writeTemporaryCopy removes the temporary copy when its update fails", async () => {
    const source = path.join(temporaryDirectory, "source.mp3");
    const destination = path.join(temporaryDirectory, "output.mp3");
    await fs.writeFile(source, "audio");

    await assert.rejects(
        writeTemporaryCopy(source, destination, async (temporary) => {
            assert.equal(path.extname(temporary), ".mp3");
            throw new Error("update failed");
        }),
        /update failed/
    );

    assert.equal(await fs.stat(destination).catch(() => null), null);
    assert.deepEqual(await fs.readdir(temporaryDirectory), ["source.mp3"]);
});
