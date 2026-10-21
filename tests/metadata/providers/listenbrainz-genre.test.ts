import assert from "node:assert/strict";
import { test } from "node:test";
import { pickGenre } from "../../../src/metadata/providers/listenbrainz-genre.js";

const genre = "genre-id";

test("pickGenre takes the most voted genre of the recording", () => {
    const tags = {
        recording: [
            { tag: "electronic", count: 7, genre_mbid: genre },
            { tag: "house", count: 9, genre_mbid: genre },
            { tag: "club/dance", count: 20 },
        ],
        release_group: [{ tag: "trip-hop", count: 50, genre_mbid: genre }],
    };

    assert.equal(pickGenre(tags), "House");
});

test("pickGenre falls back to the album, then the artist", () => {
    const artist = [{ tag: "progressive rock", count: 59, genre_mbid: genre }];

    assert.equal(
        pickGenre({
            recording: [{ tag: "favourite", count: 3 }],
            release_group: [{ tag: "art rock", genre_mbid: genre }],
            artist,
        }),
        "Art Rock"
    );
    assert.equal(pickGenre({ recording: [], artist }), "Progressive Rock");
});

test("pickGenre writes every word of a genre in title case", () => {
    const tags = { artist: [{ tag: "hip-hop soul", genre_mbid: genre }] };

    assert.equal(pickGenre(tags), "Hip-Hop Soul");
});

test("pickGenre gives nothing without a genre tag", () => {
    assert.equal(
        pickGenre({ artist: [{ tag: "british", count: 14 }] }),
        undefined
    );
    assert.equal(pickGenre(undefined), undefined);
});

function pickArtistGenre(tag: string) {
    return pickGenre({ artist: [{ tag, genre_mbid: genre }] });
}

test("pickGenre keeps acronyms and joined genres readable", () => {
    assert.equal(pickArtistGenre("r&b"), "R&B");
    assert.equal(pickArtistGenre("uk garage"), "UK Garage");
    assert.equal(pickArtistGenre("edm"), "EDM");
    assert.equal(pickArtistGenre("rock/pop"), "Rock/Pop");
});
