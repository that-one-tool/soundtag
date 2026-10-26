import assert from "node:assert/strict";
import { test } from "node:test";
import {
    addReleaseChanges,
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
};
const plan = {
    pathTerms: null,
    folderAlbum: null,
    buildRequest: () => request,
    findFolderCover: async () => null,
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

test("correctTags corrects from the path first, then asks with the path tags", async () => {
    const logger = createRecordingLogger();
    const requested: string[] = [];
    const pathPlan = {
        ...plan,
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

    assert.deepEqual(requested, ["Album"]);
    assert.deepEqual(track.corrections, [
        { field: "title", from: "Other", to: "All" },
    ]);
    assert.equal(track.tags.info.title, "All");
    assert.deepEqual(logger.infos, ['  fix    title: "Other" → "All"']);
});

test("correctTags ignores the path outside fix mode", async () => {
    const pathPlan = {
        ...plan,
        pathTerms: { title: "Other", artist: "Other", album: "Other" },
        buildRequest: () => request,
    };

    const track = await correctTags(stored, pathPlan, {
        logger: createRecordingLogger(),
    });

    assert.deepEqual(track, { tags: stored, corrections: [] });
});

const realAlbum = { album: "Real Album", covers: [] };

test("correctTags takes the confirmed folder album outside fix mode and drops the old release", async () => {
    const logger = createRecordingLogger();
    const withPosition = {
        ...stored,
        extras: { ...stored.extras, trackNumber: 3 },
    };

    const track = await correctTags(
        withPosition,
        { ...plan, folderAlbum: realAlbum },
        { logger }
    );

    assert.deepEqual(track.corrections, [
        { field: "album", from: "Album", to: "Real Album" },
    ]);
    assert.equal(track.tags.info.album, "Real Album");
    assert.deepEqual(track.tags.extras, { genre: "Rock" });
    assert.equal(track.tags.hasCover, false);
    assert.deepEqual(logger.infos, ['  fix    album: "Album" → "Real Album"']);
});

test("correctTags keeps an album tag that names the folder album", async () => {
    const remastered = { album: "Album (Remastered 2009)", covers: [] };

    for (const folderAlbum of [{ album: "ALBUM", covers: [] }, remastered]) {
        const track = await correctTags(
            stored,
            { ...plan, folderAlbum },
            { logger: createRecordingLogger() }
        );

        assert.deepEqual(track, { tags: stored, corrections: [] });
    }
});

test("correctTags fills an empty album from the folder and keeps its release", async () => {
    const withoutAlbum = { ...stored, info: { ...stored.info, album: "" } };

    const track = await correctTags(
        withoutAlbum,
        { ...plan, folderAlbum: realAlbum },
        { logger: createRecordingLogger() }
    );

    assert.equal(track.tags.info.album, "Real Album");
    assert.deepEqual(track.tags.extras, stored.extras);
    assert.equal(track.forgottenExtras, undefined);
});

test("correctTags leaves an album already spelled like the folder album", async () => {
    const track = await correctTags(
        stored,
        { ...plan, folderAlbum: { album: "Album", covers: [] } },
        { logger: createRecordingLogger() }
    );

    assert.deepEqual(track, { tags: stored, corrections: [] });
});

test("correctTags asks the services with the folder album", async () => {
    const requested: string[] = [];
    const albumPlan = {
        ...plan,
        folderAlbum: realAlbum,
        buildRequest: (info: StoredTags["info"]) => {
            requested.push(info.album);
            return request;
        },
    };

    const track = await correctTags(stored, albumPlan, {
        corrector,
        logger: createRecordingLogger(),
    });

    assert.deepEqual(requested, ["Real Album"]);
    assert.deepEqual(track.corrections, [
        { field: "album", from: "Album", to: "Real Album" },
        { field: "title", from: "all", to: "All" },
    ]);
});

test("addReleaseChanges clears the old release fields the new search did not find", () => {
    const found = {
        info: stored.info,
        extras: { trackNumber: 2 },
        coverData: null,
    };
    const track = {
        tags: stored,
        corrections: [],
        forgottenExtras: ["albumArtist", "trackNumber"] as const,
    };

    assert.deepEqual(addReleaseChanges(found, track), {
        ...found,
        clearedExtras: ["albumArtist"],
    });
    assert.equal(
        addReleaseChanges(found, { tags: stored, corrections: [] }),
        found
    );
});

test("correctTags takes the folder album's cover for a new album", async () => {
    const track = await correctTags(
        stored,
        {
            ...plan,
            folderAlbum: realAlbum,
            findFolderCover: async () => Buffer.from("album cover"),
        },
        { logger: createRecordingLogger() }
    );

    assert.equal(track.tags.hasCover, true);
    assert.deepEqual(track.folderCover, Buffer.from("album cover"));
});

test("correctTags asks no folder cover when the album stays", async () => {
    let asked = false;
    const findFolderCover = async () => {
        asked = true;
        return null;
    };

    await correctTags(
        stored,
        { ...plan, findFolderCover },
        {
            logger: createRecordingLogger(),
        }
    );

    assert.equal(asked, false);
});

test("addReleaseChanges writes the folder cover unless a cover was found", () => {
    const track = {
        tags: stored,
        corrections: [],
        folderCover: Buffer.from("album cover"),
    };
    const found = { info: stored.info, extras: {}, coverData: null };
    const withCover = { ...found, coverData: Buffer.from("song cover") };

    assert.deepEqual(
        addReleaseChanges(found, track).coverData,
        track.folderCover
    );
    assert.deepEqual(addReleaseChanges(withCover, track), withCover);
});
