import assert from "node:assert/strict";
import { test } from "node:test";
import {
    formatCorrectionsLine,
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

test("formatCorrectionsLine lists every correction on one line", () => {
    assert.equal(
        formatCorrectionsLine([
            { field: "artist", from: "Marley Bob", to: "Bob Marley" },
            { field: "year", from: "2002", to: "1978" },
        ]),
        '  fix    artist: "Marley Bob" → "Bob Marley" · year: "2002" → "1978"'
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

test("formatWriteLine names a write of corrections only", () => {
    const metadata = { info, extras: {}, coverData: null };

    assert.equal(
        formatWriteLine({ existing: info, metadata, missing: [] }),
        "  write  corrected tags"
    );
});

test("formatSkipLine gives the reason", () => {
    assert.equal(formatSkipLine("not found"), "  skip   not found");
});
