import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { readBrowserEntries } from "../../src/tui/browser-entries.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-browser-entries-test-"
);

test("readBrowserEntries lists the parent, subfolders, then audio files", async () => {
    const directory = await createTemporaryDirectory();
    await fs.mkdir(path.join(directory, "Zeta"));
    await fs.mkdir(path.join(directory, "Alpha"));
    await fs.mkdir(path.join(directory, ".hidden"));
    await fs.writeFile(path.join(directory, "b.flac"), "");
    await fs.writeFile(path.join(directory, "a.mp3"), "");
    await fs.writeFile(path.join(directory, "notes.txt"), "");

    const listing = await readBrowserEntries(directory);

    assert.deepEqual(listing, {
        entries: [
            { name: "..", path: path.dirname(directory), kind: "parent" },
            {
                name: "Alpha",
                path: path.join(directory, "Alpha"),
                kind: "folder",
            },
            {
                name: "Zeta",
                path: path.join(directory, "Zeta"),
                kind: "folder",
            },
            {
                name: "a.mp3",
                path: path.join(directory, "a.mp3"),
                kind: "file",
            },
            {
                name: "b.flac",
                path: path.join(directory, "b.flac"),
                kind: "file",
            },
        ],
    });
});

test("readBrowserEntries has no parent entry at the filesystem root", async () => {
    const root = path.parse(process.cwd()).root;

    const { entries } = await readBrowserEntries(root);

    assert.ok(entries.every((entry) => entry.kind !== "parent"));
});

test("readBrowserEntries keeps the parent entry when the folder cannot be read", async () => {
    const directory = path.join(await createTemporaryDirectory(), "missing");

    const listing = await readBrowserEntries(directory);

    assert.deepEqual(listing.entries, [
        { name: "..", path: path.dirname(directory), kind: "parent" },
    ]);
    assert.match(listing.error ?? "", /ENOENT/);
});
