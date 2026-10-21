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
    assert.ok(isSameRelease("Back in Black", ""));
    assert.ok(isSameRelease(" back in black ", "Back in Black"));
    assert.equal(isSameRelease("Greatest Hits", "Back in Black"), false);
    assert.equal(isSameRelease(undefined, "Back in Black"), false);
});
