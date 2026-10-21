import assert from "node:assert/strict";
import { test } from "node:test";
import {
    applyCorrections,
    describeCorrection,
    getCorrections,
    mergeCanonicalTracks,
} from "../../src/metadata/track-corrections.js";
import type { CanonicalTrack, TrackInfo } from "../../src/metadata/types.js";

const info: TrackInfo = {
    title: "dancing queen",
    artist: "Abba",
    album: "Gold",
    year: "2002",
};

const canonical: CanonicalTrack = {
    title: "Dancing Queen",
    artist: "ABBA",
    firstReleaseYear: "1976",
};

test("getCorrections respells the title and artist and takes the first release year", () => {
    assert.deepEqual(getCorrections(info, canonical), [
        { field: "title", from: "dancing queen", to: "Dancing Queen" },
        { field: "artist", from: "Abba", to: "ABBA" },
        { field: "year", from: "2002", to: "1976" },
    ]);
});

test("getCorrections keeps names the canonical track does not just respell", () => {
    const corrections = getCorrections(
        { ...info, title: "Dancing Queen (Live)", artist: "Abba feat. X" },
        canonical
    );

    assert.deepEqual(
        corrections.map(({ field }) => field),
        ["year"]
    );
});

function getCorrectedFields(year: string): string[] {
    return getCorrections({ ...info, year }, canonical).map(
        ({ field }) => field
    );
}

test("getCorrections keeps an earlier or equal year and fills a missing one", () => {
    assert.deepEqual(getCorrectedFields("1975"), ["title", "artist"]);
    assert.deepEqual(getCorrectedFields("1976-08-16"), ["title", "artist"]);
    assert.deepEqual(getCorrectedFields(""), ["title", "artist", "year"]);
});

test("getCorrections ignores empty canonical values and identical ones", () => {
    const empty = { title: "", artist: "", firstReleaseYear: "" };

    assert.deepEqual(getCorrections(info, empty), []);
    assert.deepEqual(
        getCorrections(
            { ...info, title: "Dancing Queen", artist: "ABBA", year: "1976" },
            canonical
        ),
        []
    );
});

test("applyCorrections writes the corrected values over the info", () => {
    assert.deepEqual(applyCorrections(info, getCorrections(info, canonical)), {
        title: "Dancing Queen",
        artist: "ABBA",
        album: "Gold",
        year: "1976",
    });
});

test("describeCorrection shows the old and new value", () => {
    assert.equal(
        describeCorrection({ field: "year", from: "2002", to: "1976" }),
        'year: "2002" → "1976"'
    );
});

test("mergeCanonicalTracks takes the first spelling and the earliest year", () => {
    assert.deepEqual(
        mergeCanonicalTracks([
            { title: "", artist: "", firstReleaseYear: "1980" },
            { title: "Dancing Queen", artist: "ABBA", firstReleaseYear: "" },
            {
                title: "Dancing queen",
                artist: "Abba",
                firstReleaseYear: "1976",
            },
        ]),
        canonical
    );
    assert.deepEqual(mergeCanonicalTracks([]), {
        title: "",
        artist: "",
        firstReleaseYear: "",
    });
});
