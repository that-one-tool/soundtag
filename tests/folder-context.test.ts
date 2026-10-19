import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { inferFolderSearchTerms } from "../src/folder-context.js";

const temporaryDirectory = path.resolve("library");

function inferFromFolders(...folders: string[]) {
    return inferFolderSearchTerms(
        path.join(temporaryDirectory, ...folders, "01.mp3"),
        temporaryDirectory
    );
}

test("inferFolderSearchTerms reads artist and album from artist-album hierarchies", () => {
    const source = path.join(
        temporaryDirectory,
        "Artist",
        "2024 - Album",
        "Disc 1",
        "01 - Track.mp3"
    );

    assert.deepEqual(inferFolderSearchTerms(source, temporaryDirectory), {
        artist: "Artist",
        album: "Album",
    });
});

test("inferFolderSearchTerms handles combined folders and soundtrack context", () => {
    assert.deepEqual(
        inferFolderSearchTerms(
            path.join(temporaryDirectory, "ACDC - Rock or Bust", "01.mp3"),
            temporaryDirectory
        ),
        { artist: "ACDC", album: "Rock or Bust" }
    );
    assert.deepEqual(
        inferFolderSearchTerms(
            path.join(temporaryDirectory, "Game of Thrones - OST", "01.mp3"),
            temporaryDirectory
        ),
        { album: "Game of Thrones - OST" }
    );
});

test("inferFolderSearchTerms ignores structural and unknown folder labels", () => {
    assert.deepEqual(
        inferFolderSearchTerms(
            path.join(
                temporaryDirectory,
                "Music",
                "iTunes Music",
                "Artiste inconnu",
                "Album inconnu",
                "01.mp3"
            ),
            temporaryDirectory
        ),
        {}
    );
    assert.deepEqual(
        inferFolderSearchTerms(
            path.join(temporaryDirectory, "Album", "Loose track.mp3"),
            temporaryDirectory
        ),
        { album: "Album" }
    );
});

test("inferFolderSearchTerms returns nothing for files in the source root", () => {
    assert.deepEqual(
        inferFolderSearchTerms(
            path.join(temporaryDirectory, "01.mp3"),
            temporaryDirectory
        ),
        {}
    );
});

test("inferFolderSearchTerms handles folders that clean to empty labels", () => {
    assert.deepEqual(inferFromFolders("2024 - "), {});
    assert.deepEqual(inferFromFolders("_ - Album"), { album: "_ - Album" });
    assert.deepEqual(inferFromFolders("_", "Album"), { album: "Album" });
    assert.deepEqual(inferFromFolders("Artist", "2024 - "), {
        artist: "Artist",
    });
});

test("inferFolderSearchTerms strips a year prefix from combined folders", () => {
    assert.deepEqual(
        inferFolderSearchTerms(
            path.join(temporaryDirectory, "Artist - 2020 - Album", "01.mp3"),
            temporaryDirectory
        ),
        { artist: "Artist", album: "Album" }
    );
});
