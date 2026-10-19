import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildProviderSearch,
    extractYear,
    fillMissingFields,
    isComplete,
    mergeMetadata,
    trimOrEmpty,
    getFilledFields,
    getFirstFilled,
} from "../src/track-metadata.js";

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

test("isComplete requires every field and cover art", () => {
    const cover = Buffer.from("cover");

    assert.equal(isComplete({ info: completeInfo, coverData: cover }), true);
    assert.equal(isComplete({ info: completeInfo, coverData: null }), false);
    assert.equal(
        isComplete({ info: { ...completeInfo, year: " " }, coverData: cover }),
        false
    );
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

test("mergeMetadata fills missing fields and keeps the first cover found", () => {
    const firstCover = Buffer.from("first");

    assert.deepEqual(
        mergeMetadata(
            { info: { ...completeInfo, album: "" }, coverData: null },
            { info: { ...completeInfo, album: "Other" }, coverData: firstCover }
        ),
        { info: { ...completeInfo, album: "Other" }, coverData: firstCover }
    );
    assert.equal(
        mergeMetadata(
            { info: completeInfo, coverData: firstCover },
            { info: completeInfo, coverData: Buffer.from("second") }
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
