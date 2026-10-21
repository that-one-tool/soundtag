import assert from "node:assert/strict";
import { test } from "node:test";
import { TrackCorrector } from "../../src/metadata/track-corrector.js";
import type {
    CanonicalSource,
    CanonicalTrack,
    TrackSearch,
} from "../../src/metadata/types.js";

const search: TrackSearch = {
    title: "dancing queen",
    artist: "Abba",
    album: "Gold",
};

function createSource(found: CanonicalTrack | null) {
    const searches: TrackSearch[] = [];
    const source: CanonicalSource = {
        name: "Fake",
        findCanonical: async (asked) => {
            searches.push(asked);
            return found;
        },
    };
    return { source, searches };
}

test("TrackCorrector asks every source and corrects from their findings", async () => {
    const spelling = createSource({
        title: "Dancing Queen",
        artist: "ABBA",
        firstReleaseYear: "",
    });
    const missing = createSource(null);
    const year = createSource({
        title: "Dancing queen",
        artist: "Abba",
        firstReleaseYear: "1976",
    });
    const corrector = new TrackCorrector([
        spelling.source,
        missing.source,
        year.source,
    ]);

    const corrections = await corrector.findCorrections(search, {
        ...search,
        year: "2002",
    });

    assert.deepEqual(
        corrections.map(({ field, to }) => [field, to]),
        [
            ["title", "Dancing Queen"],
            ["artist", "ABBA"],
            ["year", "1976"],
        ]
    );
    assert.deepEqual(year.searches, [search]);
    assert.deepEqual(missing.searches, [search]);
});

test("TrackCorrector tells whether it has any source", () => {
    assert.equal(new TrackCorrector([]).canCorrect(), false);
    assert.equal(
        new TrackCorrector([createSource(null).source]).canCorrect(),
        true
    );
});
