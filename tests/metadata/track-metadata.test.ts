import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildProviderSearch,
    extractYear,
    fillMissingExtras,
    getNewExtras,
    hasNewFields,
    fillMissingFields,
    isComplete,
    optionalCount,
    optionalText,
    removeUnknownValues,
    mergeMetadata,
    trimOrEmpty,
    getFilledFields,
    getFirstFilled,
    valueOrEmpty,
} from "../../src/metadata/track-metadata.js";

const completeInfo = {
    title: "Title",
    artist: "Artist",
    album: "Album",
    year: "2024",
};

test("fillMissingFields keeps known fields and fills blank ones", () => {
    assert.deepEqual(
        fillMissingFields(
            { title: "Known", artist: " ", album: "", year: "1999" },
            completeInfo
        ),
        { title: "Known", artist: "Artist", album: "Album", year: "1999" }
    );
});

const requiredExtras = { genre: "Rock", trackNumber: 3 };

test("isComplete requires every field, genre, track number and cover art", () => {
    const cover = Buffer.from("cover");
    const complete = {
        info: completeInfo,
        extras: requiredExtras,
        coverData: cover,
    };

    assert.equal(isComplete(complete, false), true);
    assert.equal(isComplete({ ...complete, coverData: null }, false), false);
    assert.equal(
        isComplete(
            { ...complete, info: { ...completeInfo, year: " " } },
            false
        ),
        false
    );
    assert.equal(
        isComplete({ ...complete, extras: { trackNumber: 3 } }, false),
        false
    );
    assert.equal(
        isComplete({ ...complete, extras: { genre: "Rock" } }, false),
        false
    );
});

test("isComplete counts a cover already in the file", () => {
    const metadata = {
        info: completeInfo,
        extras: requiredExtras,
        coverData: null,
    };

    assert.equal(isComplete(metadata, true), true);
});

test("fillMissingExtras keeps known extras and fills unknown ones", () => {
    assert.deepEqual(
        fillMissingExtras(
            { genre: "Known", trackNumber: undefined },
            { genre: "Other", trackNumber: 4, discNumber: 1 }
        ),
        { genre: "Known", trackNumber: 4, discNumber: 1 }
    );
});

test("fillMissingExtras fills a position and its count together", () => {
    assert.deepEqual(
        fillMissingExtras(
            { trackNumber: 5 },
            { trackNumber: 6, trackCount: 12, discNumber: 1, discCount: 3 }
        ),
        { trackNumber: 5, discNumber: 1, discCount: 3 }
    );
});

test("fillMissingExtras keeps a count without a position over an unknown candidate", () => {
    assert.deepEqual(fillMissingExtras({ trackCount: 12 }, { trackCount: 9 }), {
        trackCount: 12,
    });
});

test("fillMissingExtras keeps a count in the file over a candidate position", () => {
    assert.deepEqual(
        fillMissingExtras(
            { trackCount: 12 },
            { trackNumber: 3, trackCount: 10 }
        ),
        { trackCount: 12 }
    );
});

test("getNewExtras keeps only the groups the file did not have", () => {
    assert.deepEqual(
        getNewExtras(
            { genre: "Rock; Pop" },
            { genre: "Rock; Pop", trackNumber: 4, trackCount: 10 }
        ),
        { trackNumber: 4, trackCount: 10 }
    );
});

test("getNewExtras never returns a count without its position", () => {
    assert.deepEqual(getNewExtras({}, { discCount: 2 }), {});
});

test("getNewExtras skips a group the file has a count for", () => {
    assert.deepEqual(
        getNewExtras({ trackCount: 12 }, { trackNumber: 4, trackCount: 12 }),
        {}
    );
});

test("hasNewFields detects fields that were blank and are now filled", () => {
    assert.equal(hasNewFields(completeInfo, completeInfo), false);
    assert.equal(
        hasNewFields({ ...completeInfo, album: " " }, completeInfo),
        true
    );
});

test("removeUnknownValues drops undefined values", () => {
    assert.deepEqual(
        removeUnknownValues({ genre: "Rock", albumArtist: undefined }),
        { genre: "Rock" }
    );
});

test("optionalText trims text and treats blank text as unknown", () => {
    assert.equal(optionalText(" Rock "), "Rock");
    assert.equal(optionalText("  "), undefined);
    assert.equal(optionalText(undefined), undefined);
});

test("optionalCount treats missing and non-positive numbers as unknown", () => {
    assert.equal(optionalCount(3), 3);
    assert.equal(optionalCount(0), undefined);
    assert.equal(optionalCount(undefined), undefined);
});

test("extractYear reads the first four-digit year", () => {
    assert.equal(extractYear("18 October 2024, 12:00"), "2024");
    assert.equal(extractYear("1997-01-01"), "1997");
    assert.equal(extractYear("unknown"), "");
    assert.equal(extractYear(undefined), "");
});

test("buildProviderSearch prefers found title and artist and searched album", () => {
    assert.deepEqual(
        buildProviderSearch(
            { title: "Query", artist: "Query artist", album: "Folder album" },
            { title: "Found", artist: " ", album: "Found album", year: "" }
        ),
        { title: "Found", artist: "Query artist", album: "Folder album" }
    );
    assert.deepEqual(
        buildProviderSearch(
            { title: "Query", artist: "", album: "" },
            { title: "", artist: "", album: "Found album", year: "" }
        ),
        { title: "Query", artist: "", album: "Found album" }
    );
});

test("mergeMetadata fills missing fields and extras and keeps the first cover found", () => {
    const firstCover = Buffer.from("first");

    assert.deepEqual(
        mergeMetadata(
            {
                info: { ...completeInfo, album: "" },
                extras: { genre: "Rock" },
                coverData: null,
            },
            {
                info: { ...completeInfo, album: "Other" },
                extras: { genre: "Pop", trackNumber: 2 },
                coverData: firstCover,
            }
        ),
        {
            info: { ...completeInfo, album: "Other" },
            extras: { genre: "Rock", trackNumber: 2 },
            coverData: firstCover,
        }
    );
    assert.equal(
        mergeMetadata(
            { info: completeInfo, extras: {}, coverData: firstCover },
            {
                info: completeInfo,
                extras: {},
                coverData: Buffer.from("second"),
            }
        ).coverData,
        firstCover
    );
});

test("trimOrEmpty trims values and turns missing ones into empty strings", () => {
    assert.equal(trimOrEmpty("  Title "), "Title");
    assert.equal(trimOrEmpty(undefined), "");
});

test("getFilledFields keeps only non-blank fields", () => {
    assert.deepEqual(
        getFilledFields({
            title: "Title",
            artist: " ",
            album: "",
            year: "2024",
        }),
        { title: "Title", year: "2024" }
    );
});

test("getFilledFields ignores keys that are not track fields", () => {
    const infoWithExtraKey = { ...completeInfo, comment: "extra" };

    assert.deepEqual(getFilledFields(infoWithExtraKey), completeInfo);
});

test("getFirstFilled returns the first non-empty value", () => {
    assert.equal(getFirstFilled("", undefined, "second", "third"), "second");
    assert.equal(getFirstFilled(undefined, ""), "");
});

test("valueOrEmpty turns missing values into empty strings", () => {
    assert.equal(valueOrEmpty(" kept "), " kept ");
    assert.equal(valueOrEmpty(undefined), "");
});
