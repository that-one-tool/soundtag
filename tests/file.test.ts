import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import { findAudioFiles, getAudioFormat } from "../src/file.js";
import {
    inferFolderSearchTerms,
    isDirectory,
    parseTrackFilename,
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

test("parseTrackFilename separates an artist and title when named with a hyphen", () => {
    assert.deepEqual(parseTrackFilename("Chumbawamba - Tubthumping.mp3"), {
        artist: "Chumbawamba",
        title: "Tubthumping",
    });
    assert.deepEqual(parseTrackFilename("Artist_Name - Track.Title.mp3"), {
        artist: "Artist Name",
        title: "Track Title",
    });
    assert.deepEqual(parseTrackFilename("AC-DC - Track-Title.mp3"), {
        artist: "AC-DC",
        title: "Track-Title",
    });
    assert.deepEqual(parseTrackFilename("Tubthumping.mp3"), {
        title: "Tubthumping",
    });
});

test("parseTrackFilename removes leading track and disc-track numbers", () => {
    assert.deepEqual(parseTrackFilename("01 - Artist - Song Title.mp3"), {
        artist: "Artist",
        title: "Song Title",
    });
    assert.deepEqual(parseTrackFilename("1.02 Artist - Song Title.ogg"), {
        artist: "Artist",
        title: "Song Title",
    });
    assert.deepEqual(parseTrackFilename("12. Song_Title.mp3"), {
        title: "Song Title",
    });
});

test("parseTrackFilename recognizes en and em dash separators", () => {
    assert.deepEqual(parseTrackFilename("Artist – Song Title.mp3"), {
        artist: "Artist",
        title: "Song Title",
    });
    assert.deepEqual(parseTrackFilename("Artist—Song Title.mp3"), {
        artist: "Artist",
        title: "Song Title",
    });
});

test("parseTrackFilename keeps internal hyphens and meaningful title suffixes", () => {
    assert.deepEqual(
        parseTrackFilename("AC-DC - Track-Title (Live) feat. Guest.mp3"),
        { artist: "AC-DC", title: "Track-Title (Live) feat Guest" }
    );
    assert.deepEqual(parseTrackFilename("AC-DC.mp3"), {
        title: "AC-DC",
    });
});

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
