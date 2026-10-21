import assert from "node:assert/strict";
import { test } from "node:test";
import {
    isSameName,
    isSameRelease,
    isSameTrack,
} from "../../src/metadata/track-matching.js";

test("isSameName ignores case, accents, punctuation and noise brackets", () => {
    assert.ok(isSameName("Beyoncé", "beyonce"));
    assert.ok(isSameName("AC-DC", "ac/dc"));
    assert.ok(isSameName("Title (Remastered 2009)", "Title"));
    assert.ok(isSameName("Title [feat. Jay-Z]", "Title"));
});

test("isSameName tells other versions apart", () => {
    assert.equal(isSameName("Title (Live)", "Title"), false);
    assert.equal(isSameName("Title (Karaoke Version)", "Title"), false);
    assert.equal(isSameName(undefined, "Title"), false);
});

test("isSameTrack compares the title and the artist when one is searched", () => {
    const search = { title: "Title", artist: "AC/DC", album: "" };

    assert.ok(isSameTrack({ title: "TITLE", artist: "ac-dc" }, search));
    assert.equal(
        isSameTrack({ title: "Title", artist: "Karaoke Band" }, search),
        false
    );
    assert.ok(
        isSameTrack(
            { title: "Title", artist: "Anyone" },
            { ...search, artist: "" }
        )
    );
});

test("isSameRelease matches any release when no album is searched", () => {
    assert.ok(isSameRelease({ album: "Back in Black" }, ""));
    assert.ok(isSameRelease({ album: " back in black " }, "Back in Black"));
    assert.equal(
        isSameRelease({ album: "Greatest Hits" }, "Back in Black"),
        false
    );
    assert.equal(isSameRelease({}, "Back in Black"), false);
});

function createCoverRelease(albumArtist: string) {
    return {
        album: "Undercover, Vol. 2",
        albumArtist,
        trackArtist: "Daft Punk",
    };
}

test("isSameRelease rejects a release by another artist", () => {
    assert.equal(
        isSameRelease(createCoverRelease("The Infamous Stringdusters"), ""),
        false
    );
    assert.ok(isSameRelease(createCoverRelease("Daft Punk"), ""));
    assert.ok(isSameRelease(createCoverRelease("Daft Punk & Friends"), ""));
    assert.ok(isSameRelease(createCoverRelease("Various Artists"), ""));
    assert.ok(isSameRelease({ album: "Album", albumArtist: "Other" }, ""));
});

test("isSameName accepts one typo in a long name", () => {
    assert.ok(isSameName("Supermassive Black Hole", "Supermassive Blak Hole"));
    assert.ok(isSameName("Paranoid Android", "Paranoid Androd"));
    assert.ok(isSameName("Smells Like Teen Spirit", "Smels Like Teen Spirit"));
});

test("isSameName rejects two typos or a typo in a short name", () => {
    assert.equal(isSameName("Crazy Love", "Crazy in Love"), false);
    assert.equal(isSameName("Hallo", "Hello"), false);
});

test("isSameName rejects a typo in a number", () => {
    assert.equal(isSameName("Symphony No. 2", "Symphony No. 12"), false);
    assert.equal(isSameName("Track Title 3", "Track Title 8"), false);
    assert.equal(isSameName("Symphony I", "Symphony II"), false);
    assert.equal(isSameName("Movement XVIII", "Movement XVII"), false);
});

test("isSameName rejects other words one letter apart", () => {
    assert.equal(isSameName("Lost in Love", "Last in Love"), false);
    assert.equal(isSameName("Into the Night", "Onto the Night"), false);
    assert.equal(isSameName("Yesterdays", "Yesterday"), false);
    assert.equal(
        isSameName("Smells Like Teen Spirit", "Smells Like Ten Spirit"),
        false
    );
});

test("isSameName ignores remaster and featuring notes after a dash or at the end", () => {
    assert.ok(
        isSameName("Wish You Were Here - 2011 Remaster", "Wish You Were Here")
    );
    assert.ok(isSameName("Crazy in Love feat. Jay-Z", "Crazy in Love"));
    assert.ok(isSameName("Title - Mono", "Title"));
    assert.equal(isSameName("Title - Live", "Title"), false);
});

function findGetLucky(artist: string) {
    return { title: "Get Lucky", artist };
}

test("isSameTrack matches an artist shared by both credits", () => {
    const search = { title: "Get Lucky", artist: "Daft Punk", album: "" };

    assert.ok(
        isSameTrack(findGetLucky("Daft Punk feat. Pharrell Williams"), search)
    );
    assert.ok(
        isSameTrack(findGetLucky("Pharrell Williams & Daft Punk"), search)
    );
    assert.ok(
        isSameTrack(findGetLucky("Daft Punk"), {
            ...search,
            artist: "Daft Punk ft. Pharrell Williams",
        })
    );
    assert.ok(isSameTrack(findGetLucky("Nile Rodgers, Daft Punk"), search));
    assert.equal(isSameTrack(findGetLucky("Pharrell Williams"), search), false);
    assert.equal(
        isSameTrack(findGetLucky("Other, "), {
            ...search,
            artist: "Another, ",
        }),
        false
    );
});

test("isSameTrack ignores a leading 'The' in artist names", () => {
    const search = {
        title: "Simple Little Melody",
        artist: "Black Eyed Peas",
        album: "",
    };

    assert.ok(
        isSameTrack(
            { title: "Simple Little Melody", artist: "The Black Eyed Peas" },
            search
        )
    );
    assert.ok(
        isSameTrack(
            { title: "Title", artist: "The The" },
            { title: "Title", artist: "The The", album: "" }
        )
    );
    assert.equal(
        isSameTrack(
            { title: "Simple Little Melody", artist: "The Peas" },
            search
        ),
        false
    );
});

test("isSameRelease compares albums like names", () => {
    assert.ok(isSameRelease({ album: "The E•N•D" }, "The E.N.D."));
    assert.ok(isSameRelease({ album: "12 X 5" }, "12 x 5"));
    assert.ok(
        isSameRelease({ album: "Talkin' Blues [Remastered]" }, "Talkin’ Blues")
    );
    assert.equal(
        isSameRelease(
            { album: "Back to Black (Deluxe Edition)" },
            "Back to Black"
        ),
        false
    );
});

test("isSameTrack keeps typo tolerance for artists starting with 'The'", () => {
    const search = { title: "Help", artist: "The Beatles", album: "" };

    assert.ok(isSameTrack({ title: "Help", artist: "The Beattles" }, search));
    assert.ok(isSameTrack({ title: "Help", artist: "Beatles" }, search));
    assert.ok(
        isSameTrack(
            { title: "Help", artist: "Jay-Z feat. The Roots" },
            { ...search, artist: "Roots" }
        )
    );
});

test("isSameRelease accepts an album by the same artist with or without 'The'", () => {
    assert.ok(
        isSameRelease(
            { album: "Album", albumArtist: "The Roots", trackArtist: "Roots" },
            ""
        )
    );
});

test("isSameRelease drops only pure remaster notes from albums", () => {
    assert.ok(
        isSameRelease({ album: "Nevermind (2011 Remaster)" }, "Nevermind")
    );
    assert.ok(
        isSameRelease({ album: "Nevermind - Remastered 2011" }, "Nevermind")
    );
    assert.equal(
        isSameRelease(
            { album: "Back to Black (Deluxe Remastered Edition)" },
            "Back to Black"
        ),
        false
    );
    assert.equal(
        isSameRelease(
            { album: "Made in Japan (Live / Remastered)" },
            "Made in Japan"
        ),
        false
    );
    assert.equal(
        isSameRelease({ album: "Hits (Stereolab Remix)" }, "Hits"),
        false
    );
    assert.equal(
        isSameRelease({ album: "Album (feat. Someone)" }, "Album"),
        false
    );
});

test("isSameRelease compares albums made only of symbols as written", () => {
    assert.ok(isSameRelease({ album: "÷" }, "÷"));
    assert.equal(isSameRelease({ album: "×" }, "÷"), false);
    assert.equal(isSameRelease({}, "÷"), false);
});

test("isSameName keeps notes whose word only starts like a noise word", () => {
    assert.equal(isSameName("Title (Stereolab Remix)", "Title"), false);
    assert.equal(isSameName("Title (Monolith Sessions)", "Title"), false);
    assert.ok(isSameName("Title (Remastered)", "Title"));
});
