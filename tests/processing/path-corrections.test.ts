import assert from "node:assert/strict";
import { test } from "node:test";
import {
    chainCorrections,
    getPathCorrections,
} from "../../src/processing/path-corrections.js";

const terms = { title: "Digital Love", artist: "Daft Punk", album: "Best Of" };

test("getPathCorrections replaces the fields that name something else", () => {
    const info = {
        title: "Love Digital",
        artist: "Justice",
        album: "Discovery",
        year: "2001",
    };

    assert.deepEqual(getPathCorrections(info, terms), [
        { field: "title", from: "Love Digital", to: "Digital Love" },
        { field: "artist", from: "Justice", to: "Daft Punk" },
        { field: "album", from: "Discovery", to: "Best Of" },
    ]);
});

test("getPathCorrections leaves empty fields to the search", () => {
    const info = { title: "", artist: "", album: "", year: "" };

    assert.deepEqual(getPathCorrections(info, terms), []);
});

test("getPathCorrections keeps tags that only add a note to the path", () => {
    const info = {
        title: "Digital Love (Live)",
        artist: "Daft Punk",
        album: "Best Of (Deluxe Edition)",
        year: "",
    };

    assert.deepEqual(getPathCorrections(info, terms), []);
});

test("getPathCorrections keeps fields that only spell the path differently", () => {
    const info = {
        title: "Digital Love (Remastered)",
        artist: "Daft Punk feat. Someone",
        album: "best of",
        year: "",
    };

    assert.deepEqual(getPathCorrections(info, terms), []);
});

test("getPathCorrections keeps the album without an album folder", () => {
    const info = {
        title: "Digital Love",
        artist: "Daft Punk",
        album: "Discovery",
        year: "",
    };

    assert.deepEqual(getPathCorrections(info, { ...terms, album: "" }), []);
});

test("getPathCorrections corrects nothing without a library path", () => {
    const info = { title: "", artist: "", album: "", year: "" };

    assert.deepEqual(getPathCorrections(info, null), []);
});

test("chainCorrections keeps the original value of a field corrected twice", () => {
    const fromPath = [
        { field: "title" as const, from: "Love (Live)", to: "digital love" },
        { field: "album" as const, from: "Discovery", to: "Best Of" },
    ];
    const fromServices = [
        { field: "title" as const, from: "digital love", to: "Digital Love" },
        { field: "year" as const, from: "2005", to: "2001" },
    ];

    assert.deepEqual(chainCorrections(fromPath, fromServices), [
        { field: "title", from: "Love (Live)", to: "Digital Love" },
        { field: "album", from: "Discovery", to: "Best Of" },
        { field: "year", from: "2005", to: "2001" },
    ]);
});

test("chainCorrections drops a field corrected back to its original value", () => {
    const fromPath = [{ field: "title" as const, from: "Intro", to: "intro" }];
    const fromServices = [
        { field: "title" as const, from: "intro", to: "Intro" },
    ];

    assert.deepEqual(chainCorrections(fromPath, fromServices), []);
});

test("getPathCorrections replaces tags that only start like the path", () => {
    const info = {
        title: "Digital Love Song",
        artist: "Daft Punk",
        album: "Best Of II",
        year: "",
    };

    assert.deepEqual(
        getPathCorrections(info, terms).map(({ field }) => field),
        ["title", "album"]
    );
});
