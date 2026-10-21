import assert from "node:assert/strict";
import { test } from "node:test";
import {
    applyCorrections,
    describeCorrection,
    findAlbumReplacement,
    getFolderCandidate,
    isDisputedAlbum,
    isWrongAlbum,
    getCorrections,
    getIdentityCorrections,
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
    albums: [],
    artistAlbums: [],
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
    const empty = {
        title: "",
        artist: "",
        firstReleaseYear: "",
        albums: [],
        artistAlbums: [],
    };

    assert.deepEqual(getCorrections(info, empty), []);
    assert.deepEqual(
        getCorrections(
            { ...info, title: "Dancing Queen", artist: "ABBA", year: "1976" },
            canonical
        ),
        []
    );
});

test("getIdentityCorrections replaces the title and artist and takes the first release year", () => {
    const wrongIdentity = {
        ...info,
        title: "Abba - Dancing Queen",
        artist: "Various Artists",
    };

    const fields = ["title", "artist"] as const;

    assert.deepEqual(
        getIdentityCorrections(wrongIdentity, canonical, [...fields]),
        [
            {
                field: "title",
                from: "Abba - Dancing Queen",
                to: "Dancing Queen",
            },
            { field: "artist", from: "Various Artists", to: "ABBA" },
            { field: "year", from: "2002", to: "1976" },
        ]
    );
});

test("getIdentityCorrections keeps identical and empty canonical values", () => {
    const empty = {
        title: "",
        artist: "",
        firstReleaseYear: "",
        albums: [],
        artistAlbums: [],
    };
    const right = { ...info, title: "Dancing Queen", artist: "ABBA" };

    assert.deepEqual(getIdentityCorrections(info, empty, ["title"]), []);
    assert.deepEqual(
        getIdentityCorrections(right, canonical, ["title", "artist"]).map(
            ({ field }) => field
        ),
        ["year"]
    );
});

test("getIdentityCorrections replaces only the given fields", () => {
    const corrections = getIdentityCorrections(
        { ...info, artist: "Various Artists" },
        canonical,
        ["artist"]
    );

    assert.deepEqual(
        corrections.map(({ field }) => field),
        ["artist", "year"]
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
            {
                title: "",
                artist: "",
                firstReleaseYear: "1980",
                albums: ["Arrival"],
                artistAlbums: ["Arrival"],
            },
            {
                title: "Dancing Queen",
                artist: "ABBA",
                firstReleaseYear: "",
                albums: ["Gold", "Arrival"],
                artistAlbums: ["Gold"],
            },
            {
                title: "Dancing queen",
                artist: "Abba",
                firstReleaseYear: "1976",
                albums: [],
                artistAlbums: [],
            },
        ]),
        {
            ...canonical,
            albums: ["Arrival", "Gold"],
            artistAlbums: ["Arrival", "Gold"],
        }
    );
    assert.deepEqual(mergeCanonicalTracks([]), {
        title: "",
        artist: "",
        firstReleaseYear: "",
        albums: [],
        artistAlbums: [],
    });
});

test("isWrongAlbum flags an album the song is not on", () => {
    assert.ok(isWrongAlbum("The Half of It: A Memoir", ["Arrival"]));
    assert.equal(isWrongAlbum("", ["Arrival"]), false);
    assert.equal(isWrongAlbum("Anything", []), false);
});

test("isWrongAlbum accepts either title without its subtitle or edition note", () => {
    const pairs = [
        ["Gold", "Gold: Greatest Hits"],
        ["legend", "Legend (Deluxe)"],
        ["Get Lucky - Single", "Get Lucky"],
        ["Random Access Memories (Deluxe Edition)", "Random Access Memories"],
        ["The Wall (Disc 1)", "The Wall"],
        ["Album [Explicit]", "Album"],
    ];

    for (const [album, release] of pairs) {
        assert.equal(isWrongAlbum(album, [release]), false, album);
    }
});

test("isDisputedAlbum trusts an album its folder agrees with", () => {
    const wrong = { ...info, album: "Indie Release" };

    assert.ok(isDisputedAlbum(wrong, ["Arrival"], "Downloads"));
    assert.equal(isDisputedAlbum(wrong, ["Arrival"], "indie release"), false);
});

test("findAlbumReplacement takes only an exact release, in its listed spelling", () => {
    const releases = ["Arrival", "Live: At Wembley"];

    assert.equal(findAlbumReplacement(releases, ["", "arrival"]), "Arrival");
    assert.equal(findAlbumReplacement(releases, ["Live"]), "");
    assert.equal(findAlbumReplacement([], ["Arrival"]), "");
});

test("getFolderCandidate ignores a folder named after the artist", () => {
    assert.equal(getFolderCandidate("Arrival", "ABBA"), "Arrival");
    assert.equal(getFolderCandidate("abba", "ABBA"), "");
});

test("isWrongAlbum still checks an album that starts with a bracket", () => {
    assert.ok(isWrongAlbum("[Book]", ["Arrival"]));
    assert.equal(
        isWrongAlbum("(What's the Story) Morning Glory?", [
            "(What's the Story) Morning Glory?",
        ]),
        false
    );
});
