import assert from "node:assert/strict";
import { test } from "node:test";
import {
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
});

test("hasSuspectTags also suspects tags without an artist", () => {
    assert.ok(hasSuspectTags(createInfo("Title", " ")));
    assert.ok(hasSuspectTags(createInfo("Band - Title", "Band")));
    assert.equal(hasSuspectTags(createInfo("Title", "Band")), false);
});
