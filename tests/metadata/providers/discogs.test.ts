import assert from "node:assert/strict";
import { test } from "node:test";
import { DiscogsClient } from "../../../src/metadata/providers/discogs-client.js";
import {
    DiscogsAlbumProvider,
    DiscogsProvider,
    DiscogsTrackFinder,
} from "../../../src/metadata/providers/discogs.js";
import type {
    ProviderNeeds,
    TrackSearch,
} from "../../../src/metadata/types.js";
import { DISCOGS_COVER, mockDiscogs } from "../../helpers/discogs.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import {
    coverNeeds,
    createProviderServices,
    detailNeeds,
} from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();

const albumSearch: TrackSearch = {
    title: "Digital Love",
    artist: "Daft Punk",
    album: "Discovery",
};
const discovery = {
    id: 8,
    title: "Discovery",
    year: 2001,
    artists: [{ name: "Daft Punk", join: "" }],
    genres: ["Electronic", "Pop"],
    images: [
        { type: "secondary", uri: "https://i.discogs.test/back.jpg" },
        { type: "primary", uri: DISCOGS_COVER },
    ],
    tracklist: [
        { position: "", type_: "heading", title: "Discovery" },
        { position: "1-1", type_: "track", title: "One More Time" },
        { position: "1-2", type_: "track", title: "Digital Love" },
        { position: "2-1", type_: "track", title: "Bonus" },
    ],
};

function createFinder(): DiscogsTrackFinder {
    const services = createProviderServices();
    const client = new DiscogsClient(
        { key: "key", secret: "secret" },
        services
    );
    return new DiscogsTrackFinder(client, services);
}

function findWith(
    responses: Record<string, unknown>,
    search: TrackSearch = albumSearch,
    needs: ProviderNeeds = coverNeeds
) {
    const requested = mockDiscogs(responses);
    return { found: createFinder().find(search, needs), requested };
}

test("DiscogsTrackFinder takes the song, year, genre, numbers and cover of a master", async () => {
    const { found } = findWith({
        "/database/search": { results: [{ id: 8 }] },
        "/masters/8": discovery,
    });

    assert.deepEqual(await found, {
        info: {
            title: "Digital Love",
            artist: "Daft Punk",
            album: "Discovery",
            year: "2001",
        },
        extras: {
            genre: "Electronic",
            albumArtist: "Daft Punk",
            trackNumber: 2,
            trackCount: 2,
            discNumber: 1,
            discCount: 2,
        },
        coverData: Buffer.from("image /cover.jpg"),
    });
});

test("DiscogsTrackFinder searches releases when no master has the song, without their year", async () => {
    const release = {
        ...discovery,
        id: 5,
        year: 2021,
        tracklist: [{ position: "3", title: "Digital Love" }],
    };
    let searches = 0;
    const requested = mockDiscogs({ "/releases/5": release });
    const fetchDiscogs = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
        const url = new URL(input.toString());
        if (url.pathname === "/database/search") {
            searches++;
            const isRelease = url.searchParams.get("type") === "release";
            return Response.json({ results: isRelease ? [{ id: 5 }] : [] });
        }
        return fetchDiscogs(input, init);
    };

    const found = await createFinder().find(albumSearch, detailNeeds);

    assert.equal(searches, 2);
    assert.equal(found?.info.year, "");
    assert.deepEqual(found?.extras, {
        genre: "Electronic",
        albumArtist: "Daft Punk",
        trackNumber: 3,
        trackCount: 1,
        discNumber: 1,
        discCount: 1,
    });
    assert.equal(found?.coverData, null);
    assert.deepEqual(
        requested.map(({ url }) => url.pathname),
        ["/releases/5"]
    );
});

test("DiscogsTrackFinder finds nothing when the album lacks the song", async () => {
    const { found } = findWith(
        {
            "/database/search": { results: [{ id: 8 }] },
            "/masters/8": discovery,
        },
        { ...albumSearch, title: "Around the World" }
    );

    assert.equal(await found, null);
});

test("DiscogsTrackFinder finds nothing without search results", async () => {
    const { found, requested } = findWith({});

    assert.equal(await found, null);
    assert.equal(requested.length, 2);
});

test("DiscogsTrackFinder keeps only the song from another album", async () => {
    const { found } = findWith(
        {
            "/database/search": { results: [{ id: 8 }] },
            "/masters/8": discovery,
        },
        { ...albumSearch, album: "Alive 2007" }
    );

    assert.deepEqual(await found, {
        info: {
            title: "Digital Love",
            artist: "Daft Punk",
            album: "",
            year: "",
        },
        extras: { genre: "Electronic" },
        coverData: null,
    });
});

test("DiscogsTrackFinder reads track credits, vinyl sides and various artists", async () => {
    const compilation = {
        id: 9,
        title: "Club Hits",
        artists: [{ name: "Various" }],
        tracklist: [
            {
                position: "A1",
                title: "Digital Love",
                artists: [
                    { name: "Daft Punk (2)", join: "Feat." },
                    { name: "DJ Falcon", join: "" },
                ],
            },
        ],
    };
    const { found } = findWith(
        {
            "/database/search": { results: [{ id: 9 }] },
            "/masters/9": compilation,
        },
        { ...albumSearch, album: "Club Hits" }
    );

    assert.deepEqual(await found, {
        info: {
            title: "Digital Love",
            artist: "Daft Punk Feat. DJ Falcon",
            album: "Club Hits",
            year: "",
        },
        extras: { albumArtist: "Various Artists" },
        coverData: null,
    });
});

test("DiscogsAlbumProvider only searches a known album", async () => {
    const searched: TrackSearch[] = [];
    const finder = {
        find: async (search: TrackSearch) => {
            searched.push(search);
            return null;
        },
    } as unknown as DiscogsTrackFinder;
    const provider = new DiscogsAlbumProvider(finder);

    await provider.findMetadata({ ...albumSearch, album: "" }, coverNeeds);
    await provider.findMetadata(albumSearch, coverNeeds);

    assert.equal(provider.name, "Discogs");
    assert.deepEqual(searched, [albumSearch]);
});

test("DiscogsProvider only searches when no album is known", async () => {
    const searched: TrackSearch[] = [];
    const finder = {
        find: async (search: TrackSearch) => {
            searched.push(search);
            return null;
        },
    } as unknown as DiscogsTrackFinder;
    const provider = new DiscogsProvider(finder);
    const songSearch = { ...albumSearch, album: "" };

    await provider.findMetadata(albumSearch, coverNeeds);
    await provider.findMetadata(songSearch, coverNeeds);

    assert.equal(provider.name, "Discogs");
    assert.deepEqual(searched, [songSearch]);
});

test("DiscogsTrackFinder asks nothing when neither details nor a cover are needed", async () => {
    const { found, requested } = findWith({}, albumSearch, {
        cover: false,
        details: false,
    });

    assert.equal(await found, null);
    assert.equal(requested.length, 0);
});

test("DiscogsTrackFinder takes no compilation as the album of a song without one", async () => {
    const compilation = {
        id: 9,
        title: "Club Hits",
        year: 2004,
        artists: [{ name: "Various" }],
        tracklist: [
            {
                position: "4",
                title: "Digital Love",
                artists: [{ name: "Daft Punk" }],
            },
        ],
    };
    const { found } = findWith(
        {
            "/database/search": { results: [{ id: 9 }] },
            "/masters/9": compilation,
        },
        { ...albumSearch, album: "" }
    );

    assert.deepEqual(await found, {
        info: {
            title: "Digital Love",
            artist: "Daft Punk",
            album: "",
            year: "",
        },
        extras: {},
        coverData: null,
    });
});

test("DiscogsTrackFinder finds songs inside an index track and spaced positions", async () => {
    const album = {
        ...discovery,
        tracklist: [
            {
                type_: "index",
                title: "Suite",
                sub_tracks: [
                    { position: "CD 1 - 1", type_: "track", title: "Intro" },
                    {
                        position: "CD 1 - 2",
                        type_: "track",
                        title: "Digital Love",
                    },
                ],
            },
        ],
    };
    const { found } = findWith({
        "/database/search": { results: [{ id: 8 }] },
        "/masters/8": album,
    });

    assert.equal((await found)?.extras.trackNumber, 2);
    assert.equal((await found)?.extras.trackCount, 2);
});

test("DiscogsTrackFinder asks Discogs once per album for its tracks", async () => {
    const requested = mockDiscogs({
        "/database/search": { results: [{ id: 8 }] },
        "/masters/8": discovery,
    });
    const finder = createFinder();

    await finder.find(albumSearch, coverNeeds);
    const second = await finder.find(
        { ...albumSearch, title: "One More Time" },
        detailNeeds
    );

    assert.equal(second?.extras.trackNumber, 1);
    assert.deepEqual(
        requested
            .filter(({ url }) => url.hostname === "api.discogs.com")
            .map(({ url }) => url.pathname),
        ["/database/search", "/masters/8"]
    );
});
