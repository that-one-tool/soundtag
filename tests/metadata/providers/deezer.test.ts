import assert from "node:assert/strict";
import { test } from "node:test";
import { DeezerClient } from "../../../src/metadata/providers/deezer-client.js";
import { DeezerProvider } from "../../../src/metadata/providers/deezer.js";
import type {
    ProviderNeeds,
    ProviderServices,
    TrackSearch,
} from "../../../src/metadata/types.js";
import { DEEZER_COVER_XL, mockDeezer } from "../../helpers/deezer.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createRecordingLogger } from "../../helpers/logger.js";
import {
    coverNeeds,
    createProviderServices,
    detailNeeds,
} from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();

const search: TrackSearch = {
    title: "One More Time",
    artist: "Daft Punk",
    album: "",
};
const foundTrack = {
    id: 11,
    title: "One More Time",
    artist: { name: "Daft Punk" },
    album: { id: 7, title: "Discovery", cover_xl: DEEZER_COVER_XL },
};
const foundAlbum = {
    id: 7,
    title: "Discovery",
    release_date: "2001-03-07",
    artist: { name: "Daft Punk" },
    genres: { data: [{ name: "Electro" }] },
};
const albumTracks = {
    data: [
        { id: 10, track_position: 1, disk_number: 1 },
        { id: 11, track_position: 2, disk_number: 1 },
        { id: 12, track_position: 1, disk_number: 2 },
    ],
};
const deezerResponses = {
    "/search": { data: [foundTrack] },
    "/album/7": foundAlbum,
    "/album/7/tracks": albumTracks,
};

interface DeezerTestSetup {
    search?: TrackSearch;
    services?: ProviderServices;
}

function findWithDeezer(
    needs: ProviderNeeds,
    {
        search: trackSearch = search,
        services = createProviderServices(),
    }: DeezerTestSetup = {}
) {
    return new DeezerProvider(
        new DeezerClient(services),
        services
    ).findMetadata(trackSearch, needs);
}

test("DeezerProvider fills info, release extras and the largest cover", async () => {
    const requested = mockDeezer(deezerResponses);

    const metadata = await findWithDeezer(coverNeeds);

    assert.deepEqual(metadata, {
        info: {
            title: "One More Time",
            artist: "Daft Punk",
            album: "Discovery",
            year: "",
        },
        extras: {
            genre: "Electro",
            albumArtist: "Daft Punk",
            trackNumber: 2,
            trackCount: 2,
            discNumber: 1,
            discCount: 2,
        },
        coverData: Buffer.from("image /1000x1000.jpg"),
    });
    assert.deepEqual(requested, [
        "/search?q=Daft+Punk+One+More+Time&limit=5",
        "/album/7",
        "/album/7/tracks?limit=1000",
        "/1000x1000.jpg",
    ]);
});

test("DeezerProvider skips album calls and the cover when nothing is missing", async () => {
    const requested = mockDeezer(deezerResponses);

    const metadata = await findWithDeezer({ cover: false, details: false });

    assert.deepEqual(metadata, {
        info: {
            title: "One More Time",
            artist: "Daft Punk",
            album: "Discovery",
            year: "",
        },
        extras: {},
        coverData: null,
    });
    assert.equal(requested.length, 1);
});

test("DeezerProvider prefers the first result that is the searched track", async () => {
    const karaoke = { ...foundTrack, id: 99, title: "One More Time (Karaoke)" };
    mockDeezer({
        ...deezerResponses,
        "/search": { data: [karaoke, foundTrack] },
    });

    const metadata = await findWithDeezer(detailNeeds);

    assert.equal(metadata?.info.title, "One More Time");
    assert.equal(metadata?.extras.trackNumber, 2);
});

test("DeezerProvider returns null when no result is the searched track", async () => {
    const karaoke = { ...foundTrack, title: "One More Time (Karaoke)" };
    const requested = mockDeezer({ "/search": { data: [karaoke] } });

    assert.equal(await findWithDeezer(coverNeeds), null);
    assert.equal(requested.length, 1);
});

test("DeezerProvider prefers the searched track on the searched album", async () => {
    const compilation = {
        ...foundTrack,
        album: { id: 8, title: "Greatest Hits", cover_xl: "https://other" },
    };
    mockDeezer({
        ...deezerResponses,
        "/search": { data: [compilation, foundTrack] },
    });

    const metadata = await findWithDeezer(coverNeeds, {
        search: { ...search, album: "Discovery" },
    });

    assert.equal(metadata?.extras.trackNumber, 2);
    assert.deepEqual(metadata?.coverData, Buffer.from("image /1000x1000.jpg"));
});

test("DeezerProvider takes only the genre and no cover from another release", async () => {
    const requested = mockDeezer(deezerResponses);

    const metadata = await findWithDeezer(coverNeeds, {
        search: { ...search, album: "Greatest Hits" },
    });

    assert.equal(metadata?.info.album, "");
    assert.equal(metadata?.info.year, "");
    assert.deepEqual(metadata?.extras, { genre: "Electro" });
    assert.equal(metadata?.coverData, null);
    assert.deepEqual(requested, [
        "/search?q=Daft+Punk+One+More+Time&limit=5",
        "/album/7",
    ]);
});

test("DeezerProvider takes only the genre from a release by another artist", async () => {
    const requested = mockDeezer({
        ...deezerResponses,
        "/album/7": { ...foundAlbum, artist: { name: "Tribute Band" } },
    });

    const metadata = await findWithDeezer(coverNeeds);

    assert.deepEqual(metadata, {
        info: {
            title: "One More Time",
            artist: "Daft Punk",
            album: "",
            year: "",
        },
        extras: { genre: "Electro" },
        coverData: null,
    });
    assert.deepEqual(requested, [
        "/search?q=Daft+Punk+One+More+Time&limit=5",
        "/album/7",
    ]);
});

test("DeezerProvider leaves out positions of a track missing from the album list", async () => {
    mockDeezer({ ...deezerResponses, "/album/7/tracks": { data: [] } });

    const metadata = await findWithDeezer(detailNeeds);

    assert.deepEqual(metadata?.extras, {
        genre: "Electro",
        albumArtist: "Daft Punk",
    });
});

test("DeezerProvider leaves out positions when track ids are unknown", async () => {
    const { id: _id, ...trackWithoutId } = foundTrack;
    mockDeezer({
        ...deezerResponses,
        "/search": { data: [trackWithoutId] },
        "/album/7/tracks": { data: [{ track_position: 1, disk_number: 1 }] },
    });

    const metadata = await findWithDeezer(detailNeeds);

    assert.equal(metadata?.extras.trackNumber, undefined);
});

test("DeezerProvider takes no details from a track without an album", async () => {
    const { album: _album, ...trackWithoutAlbum } = foundTrack;
    const requested = mockDeezer({ "/search": { data: [trackWithoutAlbum] } });

    const metadata = await findWithDeezer(coverNeeds);

    assert.deepEqual(metadata, {
        info: {
            title: "One More Time",
            artist: "Daft Punk",
            album: "",
            year: "",
        },
        extras: {},
        coverData: null,
    });
    assert.equal(requested.length, 1);
});

test("DeezerProvider leaves out details Deezer does not provide", async () => {
    const { artist: _artist, ...trackWithoutArtist } = foundTrack;
    mockDeezer({
        "/search": { data: [trackWithoutArtist] },
        "/album/7": { id: 7, title: "Discovery" },
        "/album/7/tracks": { data: [{ id: 11, track_position: 2 }] },
    });

    const metadata = await findWithDeezer(detailNeeds, {
        search: { ...search, artist: "" },
    });

    assert.equal(metadata?.info.artist, "");
    assert.deepEqual(metadata?.extras, { trackNumber: 2, trackCount: 1 });
});

test("DeezerProvider returns null when nothing is found", async () => {
    mockDeezer({});

    assert.equal(await findWithDeezer(coverNeeds), null);
});

test("DeezerProvider logs a failed search and returns null", async () => {
    const logger = createRecordingLogger();
    globalThis.fetch = async () => new Response(null, { status: 500 });

    const metadata = await findWithDeezer(coverNeeds, {
        services: createProviderServices({ logger }),
    });

    assert.equal(metadata, null);
    assert.deepEqual(logger.errors, [
        "Deezer search failed: Deezer request failed: HTTP 500",
    ]);
});

test("DeezerProvider keeps the track info when the album lookup fails", async () => {
    const logger = createRecordingLogger();
    mockDeezer({
        ...deezerResponses,
        "/album/7": { error: { message: "quota" } },
    });

    const metadata = await findWithDeezer(detailNeeds, {
        services: createProviderServices({ logger }),
    });

    assert.equal(metadata?.info.album, "Discovery");
    assert.deepEqual(metadata?.extras, {});
    assert.deepEqual(logger.errors, [
        "Deezer album lookup failed: Deezer error: quota",
    ]);
});
