import assert from "node:assert/strict";
import { test } from "node:test";
import {
    correctTags,
    getCorrectedMetadata,
} from "../../src/processing/tag-corrections.js";
import { TrackCorrector } from "../../src/metadata/track-corrector.js";
import type { StoredTags } from "../../src/tags/types.js";
import { createRecordingLogger } from "../helpers/logger.js";

const stored: StoredTags = {
    info: { title: "all", artist: "Artist", album: "Album", year: "2002" },
    extras: { genre: "Rock", albumArtist: "Artist" },
    hasCover: true,
};
const request = {
    tagSearch: { title: "all", artist: "Artist", album: "Album" },
    alternatives: [],
    hasSuspectTags: false,
};
const corrector = new TrackCorrector(
    [
        {
            name: "Fake",
            findCanonical: async () => ({
                title: "All",
                artist: "Artist",
                firstReleaseYear: "",
            }),
        },
    ],
    { name: "Witness", findCanonical: async () => null }
);

test("correctTags keeps the stored tags outside fix mode", async () => {
    const logger = createRecordingLogger();

    const track = await correctTags(stored, request, { logger });

    assert.deepEqual(track, { tags: stored, corrections: [] });
    assert.deepEqual(logger.infos, []);
});

test("correctTags applies and logs the corrections", async () => {
    const logger = createRecordingLogger();

    const track = await correctTags(stored, request, { corrector, logger });

    assert.equal(track.tags.info.title, "All");
    assert.deepEqual(logger.infos, [
        "Checking the existing tags...",
        'Corrected title: "all" → "All"',
    ]);
});

// Rewriting untouched fields would flatten multi-value tags and full dates.
test("getCorrectedMetadata holds only the corrected fields", async () => {
    const track = await correctTags(stored, request, {
        corrector,
        logger: createRecordingLogger(),
    });

    assert.deepEqual(getCorrectedMetadata(track), {
        info: { title: "All", artist: "", album: "", year: "" },
        extras: {},
        coverData: null,
    });
    assert.equal(getCorrectedMetadata({ tags: stored, corrections: [] }), null);
});
