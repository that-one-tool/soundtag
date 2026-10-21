import assert from "node:assert/strict";
import { test } from "node:test";
import {
    getSuspectFields,
    hasSuspectIdentity,
    hasSuspectTags,
    hasSuspectTitle,
} from "../../src/processing/suspect-tags.js";

function createInfo(title: string, artist: string) {
    return { title, artist, album: "", year: "" };
}

test("hasSuspectTitle spots a title holding a separator or the artist", () => {
    assert.ok(hasSuspectTitle(createInfo("Alfa Rococo - Lever L'ancre", "")));
    assert.ok(hasSuspectTitle(createInfo("Intro – Live", "Band")));
    assert.ok(
        hasSuspectTitle(createInfo("Lever L'ancre Alfa Rococo", "alfa rococo"))
    );
});

test("hasSuspectTitle accepts ordinary titles", () => {
    assert.equal(
        hasSuspectTitle(createInfo("Lever l'ancre", "Alfa Rococo")),
        false
    );
    assert.equal(hasSuspectTitle(createInfo("Jay-Z Blues", "Band")), false);
    assert.equal(hasSuspectTitle(createInfo("", "Band")), false);
    assert.equal(hasSuspectTitle(createInfo("Fair Game", "Air")), false);
    assert.equal(hasSuspectTitle(createInfo("Yesterday", "Yes")), false);
});

test("hasSuspectTags also suspects tags without an artist", () => {
    assert.ok(hasSuspectTags(createInfo("Title", " ")));
    assert.ok(hasSuspectTags(createInfo("Band - Title", "Band")));
    assert.equal(hasSuspectTags(createInfo("Title", "Band")), false);
});

test("hasSuspectIdentity also suspects a compilation credit as the artist", () => {
    assert.ok(
        hasSuspectIdentity(createInfo("Stepping Out", "Various Artists"))
    );
    assert.ok(hasSuspectIdentity(createInfo("Title", "")));
    assert.equal(hasSuspectIdentity(createInfo("Title", "Band")), false);
});

test("getSuspectFields names the identity fields that look wrong", () => {
    assert.deepEqual(
        getSuspectFields(createInfo("Band - Title", "Various Artists")),
        ["title", "artist"]
    );
    assert.deepEqual(getSuspectFields(createInfo("", "Band")), ["title"]);
    assert.deepEqual(getSuspectFields(createInfo("Title", " ")), ["artist"]);
    assert.deepEqual(getSuspectFields(createInfo("Title", "Band")), []);
    assert.deepEqual(getSuspectFields(createInfo("Band - Title", "Band")), [
        "title",
    ]);
});

test("getSuspectFields trusts a version note after a dash", () => {
    assert.deepEqual(getSuspectFields(createInfo("Hello - Live", "Adele")), []);
    assert.equal(
        hasSuspectIdentity(createInfo("Hello - Live", "Adele")),
        false
    );
});
