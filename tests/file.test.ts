import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import {
    findAudioFiles,
    getAudioFormat,
    isDirectory,
    writeTemporaryCopy,
} from "../src/file.js";

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
