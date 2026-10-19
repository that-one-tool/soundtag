import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { readEntryDetails } from "../../src/tui/entry-details.js";
import { getTagStore } from "../../src/tags/audio-tags.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-entry-details-test-"
);

test("readEntryDetails reads the stored tags of a file", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "song.mp3");
    await fs.writeFile(source, "audio bytes");
    const info = {
        title: "Title",
        artist: "Artist",
        album: "Album",
        year: "2024",
    };
    await getTagStore(source).write(source, {
        info,
        coverData: Buffer.from("cover"),
    });

    const details = await readEntryDetails({
        name: "song.mp3",
        path: source,
        kind: "file",
    });

    assert.deepEqual(details, {
        kind: "file",
        format: "MP3",
        tags: { info, hasCover: true },
    });
});

test("readEntryDetails reports files whose tags cannot be read", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "broken.flac");
    await fs.writeFile(source, "not flac");

    const details = await readEntryDetails({
        name: "broken.flac",
        path: source,
        kind: "file",
    });

    assert.equal(details.kind, "unreadable");
});

test("readEntryDetails counts the audio files and subfolders of a folder", async () => {
    const directory = await createTemporaryDirectory();
    await fs.mkdir(path.join(directory, "Disc 1"));
    await fs.writeFile(path.join(directory, "a.mp3"), "");
    await fs.writeFile(path.join(directory, "b.ogg"), "");
    await fs.writeFile(path.join(directory, "cover.jpg"), "");

    const details = await readEntryDetails({
        name: "Album",
        path: directory,
        kind: "folder",
    });

    assert.deepEqual(details, {
        kind: "folder",
        audioFileCount: 2,
        subfolderCount: 1,
    });
});

test("readEntryDetails describes the parent link without reading it", async () => {
    assert.deepEqual(
        await readEntryDetails({
            name: "..",
            path: "/missing",
            kind: "parent",
        }),
        { kind: "parent" }
    );
});
