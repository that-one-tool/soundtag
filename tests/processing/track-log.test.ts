import assert from "node:assert/strict";
import { test } from "node:test";
import {
    formatSearchSubject,
    formatSkipLine,
    formatTagsLine,
    formatWriteLine,
} from "../../src/processing/track-log.js";

const info = { title: "Is This Love", artist: "", album: "Legend", year: "" };

test("formatTagsLine shows each tag and marks the empty ones", () => {
    assert.equal(
        formatTagsLine(info),
        "  tags   Is This Love · – · Legend · –"
    );
});

test("formatSearchSubject lists the filled search terms", () => {
    assert.equal(
        formatSearchSubject({ title: "Song", artist: "", album: "Album" }),
        '"Song" · Album'
    );
});

test("formatWriteLine lists the new fields and what is still missing", () => {
    const metadata = {
        info: { ...info, artist: "Bob Marley", year: "1978" },
        extras: { genre: "Reggae", trackNumber: 3, trackCount: 14 },
        coverData: Buffer.from("cover"),
    };

    assert.equal(
        formatWriteLine({ existing: info, metadata, missing: ["disc number"] }),
        '  write  artist "Bob Marley" · year "1978" · genre "Reggae" · track 3 · cover (missing: disc number)'
    );
});

test("formatSkipLine gives the reason", () => {
    assert.equal(formatSkipLine("not found"), "  skip   not found");
});

test("formatWriteLine names the cleared extras", () => {
    const metadata = {
        info,
        extras: { trackNumber: 3 },
        coverData: null,
        clearedExtras: ["albumArtist", "discNumber"] as const,
    };

    assert.equal(
        formatWriteLine({ existing: info, metadata, missing: [] }),
        "  write  track 3 · cleared album artist, disc"
    );
});
