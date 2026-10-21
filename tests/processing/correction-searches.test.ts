import assert from "node:assert/strict";
import { test } from "node:test";
import { getAlternativeSearches } from "../../src/processing/correction-searches.js";

const fileSearch = { title: "Lever L'ancre", artist: "Alfa Rococo", album: "" };

function createInfo(title: string, artist: string) {
    return { title, artist, album: "Album", year: "" };
}

function createSearches(
    info: ReturnType<typeof createInfo>,
    file = fileSearch
) {
    const tagSearch = {
        title: info.title,
        artist: info.artist,
        album: "Album",
    };
    return getAlternativeSearches(info, { tagSearch, fileSearch: file });
}

test("getAlternativeSearches splits the title, then reads the file name, without the album", () => {
    const info = createInfo(
        "Alfa Rococo - Lever L'ancre (Live)",
        "Various Artists"
    );

    assert.deepEqual(createSearches(info), [
        {
            search: {
                title: "Lever L'ancre (Live)",
                artist: "Alfa Rococo",
                album: "",
            },
            replaces: ["title", "artist"],
        },
        { search: fileSearch, replaces: ["title", "artist"] },
    ]);
});

test("getAlternativeSearches lets the file name replace only the suspect fields", () => {
    const info = createInfo("Lever L'ancre (Live)", "Various Artists");

    assert.deepEqual(createSearches(info), [
        { search: fileSearch, replaces: ["artist"] },
    ]);
});

test("getAlternativeSearches swaps the two words of an artist to replace only the artist", () => {
    const info = createInfo("Is This Love", "Marley Bob");

    assert.deepEqual(createSearches(info), [
        {
            search: { title: "Is This Love", artist: "Bob Marley", album: "" },
            replaces: ["artist"],
        },
    ]);
});

test("getAlternativeSearches skips artists that only look reversible", () => {
    const titleOnly = { title: "Is This Love", artist: "", album: "Folder" };

    for (const artist of ["The Beatles", "The Wailing Wailers", "Prince"]) {
        assert.deepEqual(
            createSearches(createInfo("Is This Love", artist), titleOnly),
            []
        );
    }
});

test("getAlternativeSearches drops repeated searches and compilation credits", () => {
    const info = createInfo("Alfa Rococo - Lever L'ancre", "");
    const sameAsSplit = { ...fileSearch, artist: "alfa rococo" };
    const variousFolder = { ...fileSearch, artist: "Various Artists" };

    assert.equal(createSearches(info, sameAsSplit).length, 1);
    assert.equal(createSearches(info, variousFolder).length, 1);
});

test("getAlternativeSearches only splits a title at a spaced separator", () => {
    const info = createInfo("Rock–Paper", "");

    assert.deepEqual(createSearches(info, { ...fileSearch, title: "" }), []);
});

test("getAlternativeSearches does not split a version note off a trusted title", () => {
    const info = createInfo("Hello - Live", "Adele");

    assert.deepEqual(createSearches(info), []);
});
