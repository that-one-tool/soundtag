import assert from "node:assert/strict";
import { test } from "node:test";
import { ListenBrainzClient } from "../../../src/metadata/providers/listenbrainz-client.js";
import { ListenBrainzProvider } from "../../../src/metadata/providers/listenbrainz.js";
import { MusicBrainzClient } from "../../../src/metadata/providers/musicbrainz-client.js";
import type {
    ProviderNeeds,
    ProviderServices,
    TrackSearch,
} from "../../../src/metadata/types.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createRecordingLogger } from "../../helpers/logger.js";
import {
    coverNeeds,
    createProviderServices,
    detailNeeds,
} from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();

const search: TrackSearch = {
    title: "Comfortably Numb",
    artist: "Pink Floyd",
    album: "",
};
const lookupMatch = {
    recording_mbid: "numb",
    recording_name: "Comfortably Numb",
    artist_credit_name: "Pink Floyd",
    release_mbid: "wall-1984",
    release_name: "The Wall",
    metadata: {
        release: {
            album_artist_name: "Pink Floyd",
            caa_id: 42,
            caa_release_mbid: "wall-art",
        },
        tag: {
            release_group: [
                { tag: "progressive rock", count: 22, genre_mbid: "genre" },
            ],
        },
    },
};
const wallRelease = {
    "release-group": { "first-release-date": "1984-09" },
    media: [
        { position: 1, "track-count": 13, tracks: [] },
        {
            position: 2,
            "track-count": 13,
            tracks: [
                {
                    position: 6,
                    recording: {
                        id: "numb",
                        "first-release-date": "1979-11-30",
                    },
                },
            ],
        },
    ],
};

interface MockedServices {
    match?: object;
    release?: object;
    releaseStatus?: number;
}

function mockServices({
    match = lookupMatch,
    release = wallRelease,
    releaseStatus = 200,
}: MockedServices = {}): string[] {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requested.push(`${url.hostname}${url.pathname}`);
        const responses: Record<string, () => Response> = {
            "api.listenbrainz.org": () => Response.json(match),
            "musicbrainz.org": () =>
                Response.json(release, { status: releaseStatus }),
        };
        const respond =
            responses[url.hostname] ??
            (() =>
                new Response("cover", {
                    headers: { "content-type": "image/jpeg" },
                }));
        return respond();
    };
    return requested;
}

function createListenBrainz(
    services: ProviderServices = createProviderServices()
) {
    const userAgent = "SoundTag/1.0 (test@example.com)";
    return new ListenBrainzProvider(
        new ListenBrainzClient({ token: "secret", userAgent }, services),
        new MusicBrainzClient(userAgent, services),
        services
    );
}

function findWithListenBrainz(
    needs: ProviderNeeds,
    trackSearch = search,
    services?: ProviderServices
) {
    return createListenBrainz(services).findMetadata(trackSearch, needs);
}

test("ListenBrainzProvider fills info, extras and cover of the matched release", async () => {
    const requested = mockServices();

    const metadata = await findWithListenBrainz(coverNeeds);

    assert.deepEqual(metadata, {
        info: {
            title: "Comfortably Numb",
            artist: "Pink Floyd",
            album: "The Wall",
            year: "1979",
        },
        extras: {
            genre: "Progressive Rock",
            albumArtist: "Pink Floyd",
            trackNumber: 6,
            trackCount: 13,
            discNumber: 2,
            discCount: 2,
        },
        coverData: Buffer.from("cover"),
    });
    assert.deepEqual(requested, [
        "api.listenbrainz.org/1/metadata/lookup/",
        "musicbrainz.org/ws/2/release/wall-1984",
        "coverartarchive.org/release/wall-art/42-500",
    ]);
});

test("ListenBrainzProvider skips MusicBrainz and the cover when not needed", async () => {
    const requested = mockServices();

    const metadata = await findWithListenBrainz({
        cover: false,
        details: false,
    });

    assert.deepEqual(metadata?.extras, {
        genre: "Progressive Rock",
        albumArtist: "Pink Floyd",
    });
    assert.equal(metadata?.info.year, "");
    assert.equal(metadata?.coverData, null);
    assert.equal(requested.length, 1);
});

test("ListenBrainzProvider needs an artist to look up", async () => {
    const requested = mockServices();

    const metadata = await findWithListenBrainz(coverNeeds, {
        ...search,
        artist: "",
    });

    assert.equal(metadata, null);
    assert.deepEqual(requested, []);
});

test("ListenBrainzProvider returns null when nothing matches", async () => {
    mockServices({ match: {} });

    assert.equal(await findWithListenBrainz(coverNeeds), null);
});

test("ListenBrainzProvider returns null for another song", async () => {
    mockServices({
        match: { ...lookupMatch, recording_name: "Crazy Love" },
    });

    assert.equal(await findWithListenBrainz(coverNeeds), null);
});

test("ListenBrainzProvider accepts a corrected typo", async () => {
    mockServices();

    const metadata = await findWithListenBrainz(detailNeeds, {
        ...search,
        title: "Comfortaby Numb",
    });

    assert.equal(metadata?.info.title, "Comfortably Numb");
});

test("ListenBrainzProvider takes only the genre from another release", async () => {
    const requested = mockServices();

    const metadata = await findWithListenBrainz(coverNeeds, {
        ...search,
        album: "Echoes",
    });

    assert.deepEqual(metadata?.extras, { genre: "Progressive Rock" });
    assert.equal(metadata?.info.album, "");
    assert.equal(metadata?.info.year, "");
    assert.equal(metadata?.coverData, null);
    assert.equal(requested.length, 1);
});

test("ListenBrainzProvider rejects a release by another artist", async () => {
    const coverBandRelease = {
        ...lookupMatch.metadata.release,
        album_artist_name: "The Infamous Stringdusters",
    };
    const requested = mockServices({
        match: {
            ...lookupMatch,
            metadata: { ...lookupMatch.metadata, release: coverBandRelease },
        },
    });

    const metadata = await findWithListenBrainz(coverNeeds);

    assert.deepEqual(metadata, {
        info: {
            title: "Comfortably Numb",
            artist: "Pink Floyd",
            album: "",
            year: "",
        },
        extras: { genre: "Progressive Rock" },
        coverData: null,
    });
    assert.equal(requested.length, 1);
});

test("ListenBrainzProvider skips the cover without Cover Art Archive art", async () => {
    const requested = mockServices({
        match: { ...lookupMatch, metadata: { release: {} } },
    });

    const metadata = await findWithListenBrainz({
        cover: true,
        details: false,
    });

    assert.equal(metadata?.coverData, null);
    assert.equal(requested.length, 1);
});

test("ListenBrainzProvider skips MusicBrainz without a release id", async () => {
    const { release_mbid: _releaseId, ...withoutRelease } = lookupMatch;
    const requested = mockServices({ match: withoutRelease });

    const metadata = await findWithListenBrainz({
        cover: false,
        details: true,
    });

    assert.equal(metadata?.info.year, "");
    assert.equal(requested.length, 1);
});

test("ListenBrainzProvider lets a failed lookup reach the lookup log", async () => {
    globalThis.fetch = async () => new Response(null, { status: 401 });

    await assert.rejects(
        findWithListenBrainz(coverNeeds, search, createProviderServices()),
        /ListenBrainz rejected the token: check LISTENBRAINZ_TOKEN\./
    );
});

test("ListenBrainzProvider keeps the match when the release lookup fails", async () => {
    const logger = createRecordingLogger();
    mockServices({ releaseStatus: 500 });

    const services = createProviderServices({ logger });

    const metadata = await services.lookups.call("ListenBrainz", () =>
        findWithListenBrainz({ cover: false, details: true }, search, services)
    );

    assert.equal(metadata?.info.album, "The Wall");
    assert.deepEqual(metadata?.extras, {
        genre: "Progressive Rock",
        albumArtist: "Pink Floyd",
    });
    assert.deepEqual(logger.infos, [
        "         ListenBrainz ✓ (release lookup failed: HTTP 500) 0.0s",
    ]);
});

test("ListenBrainzProvider gives the canonical spelling without a release lookup", async () => {
    const requested = mockServices();

    const canonical = await createListenBrainz().findCanonical({
        title: "comfortably numb",
        artist: "pink floyd",
        album: "",
    });

    assert.deepEqual(canonical, {
        title: "Comfortably Numb",
        artist: "Pink Floyd",
        firstReleaseYear: "",
    });
    assert.deepEqual(requested, ["api.listenbrainz.org/1/metadata/lookup/"]);
});

test("ListenBrainzProvider gives no canonical track for another song", async () => {
    mockServices({
        match: { ...lookupMatch, recording_name: "Crazy Love" },
    });

    assert.equal(await createListenBrainz().findCanonical(search), null);
});
