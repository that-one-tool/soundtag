import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTrackFilename } from "../src/track-name-parser.js";

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

test("parseTrackFilename falls back to the whole name when one side is empty", () => {
    assert.deepEqual(parseTrackFilename("Artist - .mp3"), {
        title: "Artist -",
    });
    assert.deepEqual(parseTrackFilename("_ – Title.mp3"), {
        title: "– Title",
    });
});
