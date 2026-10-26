import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { parseLibraryPath } from "../../src/library/library-path.js";

const library = path.resolve("library");

function parseIn(...parts: string[]) {
    return parseLibraryPath(path.join(library, ...parts));
}

test("parseLibraryPath reads a single filed in its artist folder", () => {
    assert.deepEqual(parseIn("Daft Punk", "Daft Punk - One More Time.mp3"), {
        artist: "Daft Punk",
        title: "One More Time",
        album: "",
    });
});

test("parseLibraryPath reads the album from an artist album folder", () => {
    assert.deepEqual(
        parseIn(
            "Queen",
            "Queen - Greatest Hits",
            "Queen - Bohemian Rhapsody.flac"
        ),
        { artist: "Queen", title: "Bohemian Rhapsody", album: "Greatest Hits" }
    );
});

test("parseLibraryPath needs no artist folder above the album folder", () => {
    assert.deepEqual(
        parseIn("Daft Punk - Discovery", "Daft Punk - Digital Love.mp3"),
        {
            artist: "Daft Punk",
            title: "Digital Love",
            album: "Discovery",
        }
    );
});

test("parseLibraryPath skips disc folders and a year before the album", () => {
    assert.deepEqual(
        parseIn(
            "Daft Punk - 2001 - Discovery",
            "CD1",
            "03 - Daft Punk - Digital Love.mp3"
        ),
        { artist: "Daft Punk", title: "Digital Love", album: "Discovery" }
    );
});

test("parseLibraryPath ignores case, accents form and filename substitutes", () => {
    assert.deepEqual(parseIn("AC_DC", "ac_dc - Thunderstruck.mp3"), {
        artist: "ac dc",
        title: "Thunderstruck",
        album: "",
    });
    assert.equal(parseIn("Beyoncé", "Beyoncé - Halo.mp3")?.artist, "Beyoncé");
});

test("parseLibraryPath rejects folders that do not name the file's artist", () => {
    assert.equal(parseIn("Rock", "Daft Punk - Around the World.mp3"), null);
    assert.equal(
        parseIn("Justice - Cross", "Daft Punk - Around the World.mp3"),
        null
    );
    assert.equal(parseIn("Daft Punk -", "Daft Punk - Da Funk.mp3"), null);
});

test("parseLibraryPath rejects file names without an artist and title", () => {
    assert.equal(parseIn("Daft Punk", "One More Time.mp3"), null);
});

test("parseLibraryPath drops the album and track number repeated in the file name", () => {
    assert.deepEqual(
        parseIn("Queen - Innuendo", "Queen - Innuendo - 01 - Bicycle.mp3"),
        { artist: "Queen", title: "Bicycle", album: "Innuendo" }
    );
    assert.deepEqual(parseIn("Queen", "Queen - 07 - Bicycle.mp3"), {
        artist: "Queen",
        title: "Bicycle",
        album: "",
    });
});

test("parseLibraryPath drops rip notes after the folder album", () => {
    assert.equal(
        parseIn("Queen - Innuendo (1991) [FLAC]", "Queen - Bicycle.mp3")?.album,
        "Innuendo"
    );
    assert.equal(
        parseIn("Queen - Innuendo (Disc 1)", "Queen - Bicycle.mp3")?.album,
        "Innuendo"
    );
    assert.equal(
        parseIn("Queen - Innuendo (Deluxe Edition)", "Queen - Bicycle.mp3")
            ?.album,
        "Innuendo (Deluxe Edition)"
    );
});

test("parseLibraryPath reads no album from a folder of loose tracks", () => {
    assert.equal(
        parseIn("Queen - Discography", "Queen - Bicycle.mp3")?.album,
        ""
    );
    assert.equal(parseIn("Queen - Singles", "Queen - Bicycle.mp3")?.album, "");
});

test("parseLibraryPath reads no album from a loose-track folder below the artist", () => {
    assert.deepEqual(parseIn("Queen", "Singles", "Queen - Bicycle.mp3"), {
        artist: "Queen",
        title: "Bicycle",
        album: "",
    });
    assert.equal(
        parseIn("Queen - Discography (1973-1995)", "Queen - Bicycle.mp3")
            ?.album,
        ""
    );
});

test("parseLibraryPath keeps numbers that name the album", () => {
    assert.equal(
        parseIn("Queen - Room (101)", "Queen - Bicycle.mp3")?.album,
        "Room (101)"
    );
    assert.equal(
        parseIn("Queen - Innuendo (320 kbps)", "Queen - Bicycle.mp3")?.album,
        "Innuendo"
    );
});
