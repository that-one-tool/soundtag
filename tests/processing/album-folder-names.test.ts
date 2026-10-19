import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { planAlbumFolderNames } from "../../src/processing/album-folder-names.js";
import type { FolderAlbum } from "../../src/processing/types.js";
import { createRecordingLogger } from "../helpers/logger.js";

const root = path.resolve("library");

function createAlbum(
    folder: string,
    overrides: Partial<FolderAlbum> = {}
): FolderAlbum {
    return {
        folder: path.join(root, folder),
        artist: "Artist",
        album: "Album",
        key: "artist\u0000album",
        disc: null,
        discCount: 0,
        ...overrides,
    };
}

function getNames(albums: FolderAlbum[]) {
    const logger = createRecordingLogger();
    const names = planAlbumFolderNames(albums, logger).map(
        ({ folder, name }) => [path.relative(root, folder), name]
    );
    return { names, logger };
}

test("planAlbumFolderNames names each album folder", () => {
    const { names } = getNames([
        createAlbum("a"),
        createAlbum("b", { album: "Other", key: "other" }),
    ]);

    assert.deepEqual(names, [
        ["a", "Artist - Album"],
        ["b", "Artist - Other"],
    ]);
});

test("planAlbumFolderNames keeps the disc of a disc folder name", () => {
    const { names } = getNames([createAlbum("CD2", { disc: 1 })]);

    assert.deepEqual(names, [["CD2", "Artist - Album - CD2"]]);
});

test("planAlbumFolderNames adds the disc tag of a lone disc from a set", () => {
    const { names } = getNames([
        createAlbum("x", { disc: 3, discCount: 6 }),
        createAlbum("y", { key: "y", disc: 1, discCount: 1 }),
    ]);

    assert.deepEqual(names, [
        ["x", "Artist - Album - CD3"],
        ["y", "Artist - Album"],
    ]);
});

test("planAlbumFolderNames tells sibling folders of one album apart by disc", () => {
    const { names } = getNames([
        createAlbum("1 - 2", { disc: 1 }),
        createAlbum("Disc 2", { disc: 5 }),
        createAlbum(path.join("other", "x")),
    ]);

    assert.deepEqual(names, [
        ["1 - 2", "Artist - Album - CD1"],
        ["Disc 2", "Artist - Album - Disc 2"],
        [path.join("other", "x"), "Artist - Album"],
    ]);
});

test("planAlbumFolderNames keeps sibling folders of one album without distinct discs", () => {
    const sameDiscs: [string, number | null, string, number | null][] = [
        ["MP3", 1, "WAV", null],
        ["MP3", 2, "WAV", 2],
        ["CD 1", 2, "CD1", 1],
        ["Disc 1", 1, "copy", 1],
    ];
    for (const [first, firstDisc, second, secondDisc] of sameDiscs) {
        const { names, logger } = getNames([
            createAlbum(first, { disc: firstDisc }),
            createAlbum(second, { disc: secondDisc }),
        ]);

        assert.deepEqual(names, []);
        assert.deepEqual(logger.infos, [
            "\nFolders not renamed: 2 folders hold Artist - Album without distinct discs.",
        ]);
    }
});
