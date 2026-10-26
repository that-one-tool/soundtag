import assert from "node:assert/strict";
import { test } from "node:test";
import {
    correctTags,
    getCorrectedMetadata,
} from "../../src/processing/tag-corrections.js";
import { TrackCorrector } from "../../src/metadata/track-corrector.js";
import type { StoredTags } from "../../src/tags/types.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { createProviderServices } from "../helpers/metadata-chain.js";

const stored: StoredTags = {
    info: { title: "all", artist: "Artist", album: "Album", year: "2002" },
    extras: { genre: "Rock", albumArtist: "Artist" },
    hasCover: true,
};
const request = {
    tagSearch: { title: "all", artist: "Artist", album: "Album" },
    alternatives: [],
    hasSuspectTags: false,
    folderAlbum: "",
};
const plan = { pathTerms: null, buildRequest: () => request };
const corrector = new TrackCorrector(
    [
        {
            name: "Fake",
            findCanonical: async () => ({
                title: "All",
                artist: "Artist",
                firstReleaseYear: "",
                albums: [],
                artistAlbums: [],
            }),
        },
    ],
    { name: "Witness", findCanonical: async () => null },
    createProviderServices().lookups
);

test("correctTags keeps the stored tags outside fix mode", async () => {
    const logger = createRecordingLogger();

    const track = await correctTags(stored, plan, { logger });

    assert.deepEqual(track, { tags: stored, corrections: [] });
    assert.deepEqual(logger.infos, []);
});

test("correctTags applies and logs the corrections", async () => {
    const logger = createRecordingLogger();

    const track = await correctTags(stored, plan, { corrector, logger });

    assert.equal(track.tags.info.title, "All");
    assert.deepEqual(logger.infos, ['  fix    title: "all" → "All"']);
});

// Rewriting untouched fields would flatten multi-value tags and full dates.
test("getCorrectedMetadata holds only the corrected fields", async () => {
    const track = await correctTags(stored, plan, {
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

test("correctTags drops the release fields of a corrected album so they are looked up again", async () => {
    const albumCorrector = new TrackCorrector(
        [
            {
                name: "Fake",
                findCanonical: async () => ({
                    title: "all",
                    artist: "Artist",
                    firstReleaseYear: "",
                    albums: ["Real Album"],
                    artistAlbums: ["Real Album"],
                }),
            },
        ],
        { name: "Witness", findCanonical: async () => null },
        createProviderServices().lookups
    );
    const withPosition = {
        ...stored,
        extras: { ...stored.extras, trackNumber: 3, trackCount: 9 },
    };

    const track = await correctTags(
        withPosition,
        {
            pathTerms: null,
            buildRequest: () => ({ ...request, folderAlbum: "Real Album" }),
        },
        { corrector: albumCorrector, logger: createRecordingLogger() }
    );

    assert.equal(track.tags.info.album, "Real Album");
    assert.deepEqual(track.tags.extras, { genre: "Rock" });
    assert.equal(track.tags.hasCover, false);
});

test("correctTags corrects from the path first, then asks with the path tags", async () => {
    const logger = createRecordingLogger();
    const requested: string[] = [];
    const pathPlan = {
        pathTerms: { title: "all", artist: "Artist", album: "Best Of" },
        buildRequest: (info: StoredTags["info"]) => {
            requested.push(info.album);
            return request;
        },
    };

    const track = await correctTags(
        { ...stored, info: { ...stored.info, title: "Other" } },
        pathPlan,
        { corrector, logger }
    );

    assert.deepEqual(requested, ["Best Of"]);
    assert.deepEqual(track.corrections, [
        { field: "title", from: "Other", to: "All" },
        { field: "album", from: "Album", to: "Best Of" },
    ]);
    assert.equal(track.tags.info.title, "All");
    assert.equal(track.tags.hasCover, false);
    assert.deepEqual(logger.infos, [
        '  fix    title: "Other" → "All" · album: "Album" → "Best Of"',
    ]);
});

test("correctTags ignores the path outside fix mode", async () => {
    const pathPlan = {
        pathTerms: { title: "Other", artist: "Other", album: "Other" },
        buildRequest: () => request,
    };

    const track = await correctTags(stored, pathPlan, {
        logger: createRecordingLogger(),
    });

    assert.deepEqual(track, { tags: stored, corrections: [] });
});
