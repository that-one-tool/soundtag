import assert from "node:assert/strict";
import { test } from "node:test";
import { createMetadataLookups } from "../../src/metadata/create-metadata-chain.js";
import { createFakeClock } from "../helpers/clock.js";
import { withoutDeezerMatches } from "../helpers/deezer.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import {
    createTestChain,
    emptyTags,
    findTrackMetadata,
} from "../helpers/metadata-chain.js";

restoreFetchAfterEach();

test("findTrackMetadata gets track info and downloads medium cover art", async () => {
    const image = Buffer.from("image-data");
    const requests: URL[] = [];
    const output: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: Parameters<typeof console.log>) => {
        output.push(args.map(String).join(" "));
    };

    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());
        requests.push(url);

        if (url.hostname === "ws.audioscrobbler.com") {
            if (url.searchParams.get("method") === "track.search") {
                return Response.json({
                    results: {
                        trackmatches: {
                            track: {
                                name: "Matched title",
                                artist: { name: "Matched artist" },
                            },
                        },
                    },
                });
            }

            return Response.json({
                track: {
                    album: {
                        title: "Matched album",
                        date: "18 October 2024, 12:00",
                        image: [
                            {
                                size: "medium",
                                "#text": "https://images.example/medium.jpg",
                            },
                            {
                                size: "small",
                                "#text": "https://images.example/small.jpg",
                            },
                        ],
                    },
                },
            });
        }

        if (url.hostname === "api.deezer.com") {
            return Response.json({ data: [] });
        }
        return new Response(image, {
            headers: { "content-type": "image/jpeg" },
        });
    });

    let metadata;
    try {
        metadata = await findTrackMetadata(
            { title: "Matched title" },
            { verbose: true }
        );
    } finally {
        console.log = originalConsoleLog;
    }

    assert.deepEqual(metadata, {
        info: {
            title: "Matched title",
            artist: "Matched artist",
            album: "Matched album",
            year: "2024",
        },
        extras: {},
        coverData: image,
    });
    const [itunesRequest, ...lastFmRequests] = requests;
    assert.equal(requests.length, 4);
    assert.equal(itunesRequest.hostname, "itunes.apple.com");
    assert.equal(lastFmRequests[0].searchParams.get("track"), "Matched title");
    assert.equal(lastFmRequests[0].searchParams.get("method"), "track.search");
    assert.equal(lastFmRequests[1].searchParams.get("method"), "track.getInfo");
    assert.equal(
        lastFmRequests[1].searchParams.get("artist"),
        "Matched artist"
    );
    assert.equal(lastFmRequests[1].searchParams.get("track"), "Matched title");
    assert.equal(lastFmRequests[1].searchParams.get("autocorrect"), "1");
    assert.equal(lastFmRequests[2].href, "https://images.example/medium.jpg");
    assert.ok(
        output.some((line) => /Last\.fm ✓ title, artist, album/.test(line))
    );
    assert.equal(
        output.some((line) => line.includes("test-key")),
        false
    );
});

test("findTrackMetadata does not log the track info URL unless verbose is enabled", async () => {
    const output: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: Parameters<typeof console.log>) => {
        output.push(args.map(String).join(" "));
    };
    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: {
                    trackmatches: {
                        track: { name: "Title", artist: "Artist" },
                    },
                },
            });
        }

        return Response.json({ track: {} });
    });

    try {
        await findTrackMetadata({ title: "Title" });
    } finally {
        console.log = originalConsoleLog;
    }

    assert.equal(
        output.some((line) => line.startsWith("Last.fm track.getInfo URL:")),
        false
    );
});

test("findTrackMetadata constrains the search by artist and removes a repeated artist prefix", async () => {
    const requests: URL[] = [];

    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());
        requests.push(url);

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: {
                    trackmatches: {
                        track: {
                            name: "Chumbawamba - Tubthumping",
                            artist: "Chumbawamba",
                        },
                    },
                },
            });
        }

        return Response.json({ track: {} });
    });

    await findTrackMetadata({ title: "Tubthumping", artist: "Chumbawamba" });

    const [infoRequest, searchRequest] = requests.filter(
        (url) => url.hostname === "ws.audioscrobbler.com"
    );
    assert.equal(infoRequest.searchParams.get("method"), "track.getInfo");
    assert.equal(infoRequest.searchParams.get("artist"), "Chumbawamba");
    assert.equal(infoRequest.searchParams.get("track"), "Tubthumping");
    assert.equal(searchRequest.searchParams.get("method"), "track.search");
    assert.equal(searchRequest.searchParams.get("track"), "Tubthumping");
    assert.equal(searchRequest.searchParams.get("artist"), "Chumbawamba");
    assert.equal(
        requests.filter((url) => url.hostname === "ws.audioscrobbler.com")
            .length,
        2
    );
});

test("findTrackMetadata uses MusicBrainz and Cover Art Archive for a matching recording", async () => {
    const image = Buffer.from("cover-art");
    const requests: { url: URL; userAgent?: string }[] = [];

    globalThis.fetch = withoutDeezerMatches(async (input, init) => {
        const url = new URL(input.toString());
        requests.push({
            url,
            userAgent:
                new Headers(init?.headers).get("user-agent") ?? undefined,
        });

        if (url.hostname === "ws.audioscrobbler.com") {
            if (url.searchParams.get("method") === "track.search") {
                return Response.json({
                    results: {
                        trackmatches: {
                            track: {
                                name: "Tubthumping",
                                artist: "Chumbawamba",
                            },
                        },
                    },
                });
            }

            return Response.json({ track: { album: { image: [] } } });
        }

        if (url.hostname === "musicbrainz.org") {
            return Response.json({
                recordings: [
                    {
                        title: "Tubthumping",
                        "artist-credit": [{ name: "Chumbawamba" }],
                        "first-release-date": "1997-10-27",
                        releases: [
                            {
                                id: "release-id",
                                title: "MusicBrainz Album",
                            },
                        ],
                    },
                ],
            });
        }

        return new Response(image, {
            headers: { "content-type": "image/jpeg" },
        });
    });

    const metadata = await findTrackMetadata(
        { title: "Tubthumping", artist: "Chumbawamba" },
        { musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)" }
    );

    assert.deepEqual(metadata, {
        info: {
            title: "Tubthumping",
            artist: "Chumbawamba",
            album: "MusicBrainz Album",
            year: "1997",
        },
        extras: {},
        coverData: image,
    });
    const musicBrainzRequest = requests.find(
        ({ url }) => url.hostname === "musicbrainz.org"
    );
    assert.ok(musicBrainzRequest);
    assert.equal(
        musicBrainzRequest.url.searchParams.get("query"),
        'recording:"Tubthumping" AND artist:"Chumbawamba"'
    );
    assert.equal(
        musicBrainzRequest.userAgent,
        "SoundTag/1.0 (test@example.com)"
    );
    assert.equal(
        requests.find(({ url }) => url.hostname === "coverartarchive.org")?.url
            .pathname,
        "/release/release-id/front-500"
    );
});

test("findTrackMetadata joins MusicBrainz artist credits", async () => {
    const image = Buffer.from("cover-art");
    let musicBrainzUserAgent = "";

    globalThis.fetch = withoutDeezerMatches(async (input, init) => {
        const url = new URL(input.toString());

        if (url.hostname === "ws.audioscrobbler.com") {
            return Response.json({ results: { trackmatches: { track: [] } } });
        }

        if (url.hostname === "musicbrainz.org") {
            musicBrainzUserAgent =
                new Headers(init?.headers).get("user-agent") ?? "";
            return Response.json({
                recordings: [
                    {
                        title: "Fallback title",
                        "artist-credit": [
                            { name: "First artist", joinphrase: " & " },
                            { artist: { name: "Second artist" } },
                        ],
                        releases: [
                            {
                                id: "release-id",
                                title: "Fallback album",
                                date: "1997-01-01",
                            },
                        ],
                    },
                ],
            });
        }

        return new Response(image, {
            headers: { "content-type": "image/jpeg" },
        });
    });

    assert.deepEqual(
        await findTrackMetadata(
            {
                title: "Fallback title",
                artist: "First artist & Second artist",
            },
            { musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)" }
        ),
        {
            info: {
                title: "Fallback title",
                artist: "First artist & Second artist",
                album: "Fallback album",
                year: "1997",
            },
            extras: {},
            coverData: image,
        }
    );
    assert.equal(musicBrainzUserAgent, "SoundTag/1.0 (test@example.com)");
});

test("findTrackMetadata replaces a whitespace-only existing year with a fallback year", async () => {
    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());

        if (url.hostname === "ws.audioscrobbler.com") {
            return Response.json({ results: { trackmatches: { track: [] } } });
        }

        if (url.hostname === "musicbrainz.org") {
            return Response.json({
                recordings: [
                    {
                        title: "Existing title",
                        "artist-credit": [{ name: "Existing artist" }],
                        "first-release-date": "1997-01-01",
                        releases: [{ title: "Fallback album" }],
                    },
                ],
            });
        }

        return new Response(null, { status: 404 });
    });

    const metadata = await findTrackMetadata(
        { title: "Title", artist: "Artist" },
        { musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)" },
        {
            title: "Existing title",
            artist: "Existing artist",
            album: "Existing album",
            year: "   ",
        }
    );

    assert.equal(metadata?.info.year, "1997");
});

test("Last.fm rate limiting does not delay MusicBrainz requests", async () => {
    let releaseFirstLastFmSearch!: () => void;
    let resolveSecondMusicBrainzRequest!: () => void;
    const firstLastFmSearchReleased = new Promise<void>((resolve) => {
        releaseFirstLastFmSearch = resolve;
    });
    const secondMusicBrainzRequest = new Promise<void>((resolve) => {
        resolveSecondMusicBrainzRequest = resolve;
    });
    let firstLastFmSearchStarted!: () => void;
    const firstLastFmSearch = new Promise<void>((resolve) => {
        firstLastFmSearchStarted = resolve;
    });
    const musicBrainzRequests: string[] = [];
    const lastFmSearches: string[] = [];

    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());

        if (url.hostname === "musicbrainz.org") {
            musicBrainzRequests.push(url.href);

            if (musicBrainzRequests.length === 2) {
                resolveSecondMusicBrainzRequest();
            }

            return Response.json({ recordings: [] });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({ results: [] });
        }

        const title = url.searchParams.get("track") ?? "";
        lastFmSearches.push(title);

        if (title === "First title") {
            firstLastFmSearchStarted();
            await firstLastFmSearchReleased;
        }

        return Response.json({ results: { trackmatches: { track: [] } } });
    });

    const chain = createTestChain({
        musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
    });
    const firstTrack = chain.find(
        { title: "First title", artist: "", album: "" },
        emptyTags
    );
    await firstLastFmSearch;

    const secondTrack = chain.find(
        { title: "Second title", artist: "", album: "" },
        emptyTags
    );
    await secondMusicBrainzRequest;

    assert.deepEqual(lastFmSearches, ["First title"]);
    releaseFirstLastFmSearch();
    await Promise.all([firstTrack, secondTrack]);

    assert.deepEqual(lastFmSearches, ["First title", "Second title"]);
});

test("findTrackMetadata leaves Last.fm data intact when MusicBrainz has no result", async () => {
    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());

        if (url.hostname === "ws.audioscrobbler.com") {
            if (url.searchParams.get("method") === "track.search") {
                return Response.json({
                    results: {
                        trackmatches: {
                            track: { name: "Title", artist: "Artist" },
                        },
                    },
                });
            }

            return Response.json({
                track: { album: { title: "Album", image: [] } },
            });
        }

        return Response.json({ recordings: [] });
    });

    assert.deepEqual(
        await findTrackMetadata(
            { title: "Title" },
            { musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)" }
        ),
        {
            info: {
                title: "Title",
                artist: "Artist",
                album: "Album",
                year: "",
            },
            extras: {},
            coverData: null,
        }
    );
});

test("findTrackMetadata preserves partial Last.fm metadata when MusicBrainz fails", async () => {
    const errors: string[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: Parameters<typeof console.error>) => {
        errors.push(args.map(String).join(" "));
    };
    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());

        if (url.hostname === "ws.audioscrobbler.com") {
            if (url.searchParams.get("method") === "track.search") {
                return Response.json({
                    results: {
                        trackmatches: {
                            track: { name: "Title", artist: "Artist" },
                        },
                    },
                });
            }

            return Response.json({ track: {} });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({ results: [] });
        }

        return new Response("Unavailable", { status: 503 });
    });

    let metadata;
    try {
        metadata = await findTrackMetadata(
            { title: "Title" },
            { musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)" }
        );
    } finally {
        console.error = originalConsoleError;
    }

    assert.deepEqual(metadata, {
        info: { title: "Title", artist: "Artist", album: "", year: "" },
        extras: {},
        coverData: null,
    });
    assert.deepEqual(errors, []);
});

test("findTrackMetadata uses large cover art when it is below 500 KB", async () => {
    const image = Buffer.from("large-image");
    const imageRequests: string[] = [];

    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());

        if (url.hostname === "ws.audioscrobbler.com") {
            if (url.searchParams.get("method") === "track.search") {
                return Response.json({
                    results: {
                        trackmatches: {
                            track: { name: "Title", artist: "Artist" },
                        },
                    },
                });
            }

            return Response.json({
                track: {
                    album: {
                        image: [
                            {
                                size: "large",
                                "#text": "https://images.example/large.jpg",
                            },
                            {
                                size: "medium",
                                "#text": "https://images.example/medium.jpg",
                            },
                        ],
                    },
                },
            });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({ results: [] });
        }

        imageRequests.push(url.href);
        return new Response(image, {
            headers: { "content-type": "image/jpeg" },
        });
    });

    const metadata = await findTrackMetadata({ title: "Title" });

    assert.deepEqual(metadata?.coverData, image);
    assert.deepEqual(imageRequests, ["https://images.example/large.jpg"]);
});

test("findTrackMetadata falls back to medium when large cover is not under 500 KB", async () => {
    const mediumImage = Buffer.from("medium-image");
    const imageRequests: string[] = [];

    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());

        if (url.hostname === "ws.audioscrobbler.com") {
            if (url.searchParams.get("method") === "track.search") {
                return Response.json({
                    results: {
                        trackmatches: {
                            track: { name: "Title", artist: "Artist" },
                        },
                    },
                });
            }

            return Response.json({
                track: {
                    album: {
                        image: [
                            {
                                size: "large",
                                "#text": "https://images.example/large.jpg",
                            },
                            {
                                size: "medium",
                                "#text": "https://images.example/medium.jpg",
                            },
                            {
                                size: "small",
                                "#text": "https://images.example/small.jpg",
                            },
                        ],
                    },
                },
            });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({ results: [] });
        }

        imageRequests.push(url.href);
        if (url.pathname.endsWith("large.jpg")) {
            return new Response(new Uint8Array(500 * 1024), {
                headers: { "content-type": "image/jpeg" },
            });
        }

        return new Response(mediumImage, {
            headers: { "content-type": "image/jpeg" },
        });
    });

    const metadata = await findTrackMetadata({ title: "Title" });

    assert.deepEqual(metadata?.coverData, mediumImage);
    assert.deepEqual(imageRequests, [
        "https://images.example/large.jpg",
        "https://images.example/medium.jpg",
    ]);
});

test("findTrackMetadata uses small cover art when medium is unavailable", async () => {
    const image = Buffer.from("small-image");
    const imageRequests: string[] = [];

    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());

        if (url.hostname === "ws.audioscrobbler.com") {
            if (url.searchParams.get("method") === "track.search") {
                return Response.json({
                    results: {
                        trackmatches: {
                            track: { name: "Title", artist: "Artist" },
                        },
                    },
                });
            }

            return Response.json({
                track: {
                    album: {
                        title: "Album",
                        image: [
                            {
                                size: "small",
                                "#text": "https://images.example/small.jpg",
                            },
                        ],
                    },
                },
            });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({ results: [] });
        }

        imageRequests.push(url.href);
        return new Response(image, {
            headers: { "content-type": "image/jpeg" },
        });
    });

    const metadata = await findTrackMetadata({ title: "Title" });

    assert.deepEqual(metadata?.coverData, image);
    assert.deepEqual(imageRequests, ["https://images.example/small.jpg"]);
});

test("findTrackMetadata falls back to small cover when medium cannot be downloaded", async () => {
    const image = Buffer.from("small-image");
    const imageRequests: string[] = [];

    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());

        if (url.hostname === "ws.audioscrobbler.com") {
            if (url.searchParams.get("method") === "track.search") {
                return Response.json({
                    results: {
                        trackmatches: {
                            track: { name: "Title", artist: "Artist" },
                        },
                    },
                });
            }

            return Response.json({
                track: {
                    album: {
                        image: [
                            {
                                size: "medium",
                                "#text": "https://images.example/medium.jpg",
                            },
                            {
                                size: "small",
                                "#text": "https://images.example/small.jpg",
                            },
                        ],
                    },
                },
            });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({ results: [] });
        }

        imageRequests.push(url.href);
        if (url.pathname.endsWith("medium.jpg")) {
            return new Response("not available", { status: 404 });
        }

        return new Response(image, {
            headers: { "content-type": "image/jpeg" },
        });
    });

    const metadata = await findTrackMetadata({ title: "Title" });

    assert.deepEqual(metadata?.coverData, image);
    assert.deepEqual(imageRequests, [
        "https://images.example/medium.jpg",
        "https://images.example/small.jpg",
    ]);
});

test("findTrackMetadata returns null when neither service has a match and fallback is unconfigured", async () => {
    let requestCount = 0;
    globalThis.fetch = withoutDeezerMatches(async (input) => {
        requestCount++;
        const url = new URL(input.toString());
        if (url.hostname === "itunes.apple.com") {
            return Response.json({ results: [] });
        }
        return Response.json({ results: { trackmatches: { track: [] } } });
    });

    assert.equal(await findTrackMetadata({ title: "missing track" }), null);
    assert.equal(requestCount, 2);
});

test("findTrackMetadata uses iTunes to fill missing metadata and artwork", async () => {
    const cover = Buffer.from("itunes-cover");
    const requests: URL[] = [];

    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());
        requests.push(url);

        if (url.hostname === "ws.audioscrobbler.com") {
            return Response.json({ results: { trackmatches: { track: [] } } });
        }

        if (url.hostname === "musicbrainz.org") {
            return Response.json({ recordings: [] });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({
                resultCount: 1,
                results: [
                    {
                        trackName: "Search Title",
                        artistName: "Search Artist",
                        collectionName: "iTunes album",
                        releaseDate: "2023-05-12T07:00:00Z",
                        artworkUrl100: "https://images.example/itunes.jpg",
                    },
                ],
            });
        }

        return new Response(cover, {
            headers: { "content-type": "image/jpeg" },
        });
    });

    const metadata = await findTrackMetadata(
        { title: "search title", artist: "search artist" },
        { musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)" }
    );

    assert.deepEqual(metadata, {
        info: {
            title: "Search Title",
            artist: "Search Artist",
            album: "iTunes album",
            year: "2023",
        },
        extras: {},
        coverData: cover,
    });
    const itunesRequest = requests.find(
        ({ hostname }) => hostname === "itunes.apple.com"
    );
    assert.ok(itunesRequest);
    assert.equal(itunesRequest.pathname, "/search");
    assert.equal(
        itunesRequest.searchParams.get("term"),
        "search artist search title"
    );
    assert.equal(itunesRequest.searchParams.get("country"), "US");
    assert.equal(itunesRequest.searchParams.get("entity"), "song");
    assert.equal(itunesRequest.searchParams.get("limit"), "1");
    assert.ok(
        requests.some(
            ({ href }) => href === "https://images.example/itunes.jpg"
        )
    );
});

test("findTrackMetadata includes album context in fallback provider searches", async () => {
    const requests: URL[] = [];
    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());
        requests.push(url);

        if (url.hostname === "ws.audioscrobbler.com") {
            return Response.json({ results: { trackmatches: { track: [] } } });
        }

        if (url.hostname === "musicbrainz.org") {
            return Response.json({ recordings: [] });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({ results: [] });
        }

        throw new Error(`Unexpected request: ${url}`);
    });

    assert.equal(
        await findTrackMetadata(
            {
                title: "Track title",
                artist: "Folder artist",
                album: "Folder album",
            },
            { musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)" }
        ),
        null
    );

    const musicBrainzRequest = requests.find(
        ({ hostname }) => hostname === "musicbrainz.org"
    );
    assert.ok(musicBrainzRequest);
    assert.equal(
        musicBrainzRequest.searchParams.get("query"),
        'recording:"Track title" AND artist:"Folder artist" AND release:"Folder album"'
    );
    const itunesRequest = requests.find(
        ({ hostname }) => hostname === "itunes.apple.com"
    );
    assert.ok(itunesRequest);
    assert.equal(
        itunesRequest.searchParams.get("term"),
        "Folder artist Track title Folder album"
    );
});

test("iTunes fallback does not replace metadata already found by Last.fm", async () => {
    const requests: URL[] = [];
    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());
        requests.push(url);

        if (url.hostname === "ws.audioscrobbler.com") {
            if (url.searchParams.get("method") === "track.search") {
                return Response.json({
                    results: {
                        trackmatches: {
                            track: {
                                name: "Last.fm title",
                                artist: "Last.fm artist",
                            },
                        },
                    },
                });
            }
            return Response.json({
                track: {
                    album: {
                        title: "Last.fm album",
                        year: "2022",
                        image: [],
                    },
                },
            });
        }

        if (url.hostname === "musicbrainz.org") {
            return Response.json({ recordings: [] });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({
                results: [
                    {
                        trackName: "Other title",
                        artistName: "Other artist",
                        collectionName: "Other album",
                        releaseDate: "2024-01-01",
                    },
                ],
            });
        }

        throw new Error(`Unexpected request: ${url}`);
    });

    const metadata = await findTrackMetadata(
        { title: "Last.fm title" },
        { musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)" }
    );

    assert.deepEqual(metadata, {
        info: {
            title: "Last.fm title",
            artist: "Last.fm artist",
            album: "Last.fm album",
            year: "2022",
        },
        extras: {},
        coverData: null,
    });
    assert.ok(requests.some(({ hostname }) => hostname === "itunes.apple.com"));
    assert.equal(
        requests.some(({ hostname }) => hostname === "www.googleapis.com"),
        false
    );
});

test("findTrackMetadata uses a YouTube thumbnail only after provider artwork is missing", async () => {
    const thumbnail = Buffer.from("youtube-thumbnail");
    const requests: URL[] = [];

    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());
        requests.push(url);

        if (url.hostname === "ws.audioscrobbler.com") {
            if (url.searchParams.get("method") === "track.search") {
                return Response.json({
                    results: {
                        trackmatches: {
                            track: {
                                name: "Matched title",
                                artist: "Matched artist",
                            },
                        },
                    },
                });
            }
            return Response.json({
                track: { album: { title: "Matched album", year: "2021" } },
            });
        }

        if (url.hostname === "musicbrainz.org") {
            return Response.json({ recordings: [] });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({
                results: [
                    {
                        trackName: "Other title",
                        artistName: "Other artist",
                        collectionName: "Other album",
                        releaseDate: "2024-01-01",
                    },
                ],
            });
        }

        if (url.hostname === "www.googleapis.com") {
            return Response.json({
                items: [
                    {
                        snippet: {
                            thumbnails: {
                                high: {
                                    url: "https://i.ytimg.com/vi/video-id/hqdefault.jpg",
                                },
                                default: {
                                    url: "https://i.ytimg.com/vi/video-id/default.jpg",
                                },
                            },
                        },
                    },
                ],
            });
        }

        return new Response(thumbnail, {
            headers: { "content-type": "image/jpeg" },
        });
    });

    const metadata = await findTrackMetadata(
        { title: "Matched title", artist: "Matched artist" },
        {
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
            youtubeApiKey: "youtube-test-key",
        }
    );

    assert.deepEqual(metadata, {
        info: {
            title: "Matched title",
            artist: "Matched artist",
            album: "Matched album",
            year: "2021",
        },
        extras: {},
        coverData: thumbnail,
    });
    const youtubeRequest = requests.find(
        ({ hostname }) => hostname === "www.googleapis.com"
    );
    assert.ok(youtubeRequest);
    assert.equal(youtubeRequest.pathname, "/youtube/v3/search");
    assert.equal(youtubeRequest.searchParams.get("part"), "snippet");
    assert.equal(youtubeRequest.searchParams.get("type"), "video");
    assert.equal(youtubeRequest.searchParams.get("maxResults"), "1");
    assert.equal(
        youtubeRequest.searchParams.get("q"),
        "Matched artist Matched title"
    );
    assert.equal(youtubeRequest.searchParams.get("key"), "youtube-test-key");
    assert.ok(
        requests.some(
            ({ href }) =>
                href === "https://i.ytimg.com/vi/video-id/hqdefault.jpg"
        )
    );
});

function mockLastFmAlbumCover(imageRequests: string[]): void {
    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());

        if (url.hostname === "images.example") {
            imageRequests.push(url.href);
            return new Response("image", {
                headers: { "content-type": "image/jpeg" },
            });
        }

        return Response.json({
            results: { trackmatches: { track: { name: "T", artist: "A" } } },
            track: {
                album: {
                    title: "Album",
                    image: [
                        {
                            size: "medium",
                            "#text": "https://images.example/album.jpg",
                        },
                    ],
                },
            },
        });
    });
}

test("the chain downloads a shared album cover once until its cache is cleared", async () => {
    const imageRequests: string[] = [];
    mockLastFmAlbumCover(imageRequests);
    const chain = createTestChain();
    const search = { title: "T", artist: "A", album: "" };

    await chain.find(search, emptyTags);
    await chain.find(search, emptyTags);
    chain.clearCache();
    const metadata = await chain.find(search, emptyTags);

    assert.deepEqual(metadata?.coverData, Buffer.from("image"));
    assert.equal(imageRequests.length, 2);
});

function mockLastFmThenDeezer(requests: URL[]): void {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requests.push(url);

        if (url.hostname === "ws.audioscrobbler.com") {
            return Response.json(getLastFmDiscoveryResponse(url));
        }

        if (url.hostname === "api.deezer.com") {
            return Response.json(deezerDiscovery[url.pathname] ?? {});
        }

        if (url.hostname === "musicbrainz.org") {
            return Response.json({ recordings: [] });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({ results: [] });
        }

        return new Response("deezer-cover", {
            headers: { "content-type": "image/jpeg" },
        });
    };
}

function getLastFmDiscoveryResponse(url: URL): object {
    return url.searchParams.get("method") === "track.search"
        ? {
              results: {
                  trackmatches: {
                      track: { name: "One More Time", artist: "Daft Punk" },
                  },
              },
          }
        : { track: { album: { title: "Discovery" } } };
}

const deezerDiscovery: Record<string, object> = {
    "/search": {
        data: [
            {
                id: 11,
                title: "One More Time",
                artist: { name: "Daft Punk" },
                album: {
                    id: 7,
                    title: "Discovery",
                    cover_xl: "https://cdn.deezer.test/xl.jpg",
                },
            },
        ],
    },
    "/album/7": {
        title: "Discovery",
        release_date: "2001-03-07",
        artist: { name: "Daft Punk" },
        genres: { data: [{ name: "Electro" }] },
    },
    "/album/7/tracks": {
        data: [{ id: 11, track_position: 1, disk_number: 1 }],
    },
};

test("findTrackMetadata fills a track with Deezer and leaves the year to later providers", async () => {
    const requests: URL[] = [];
    mockLastFmThenDeezer(requests);

    const metadata = await findTrackMetadata({ title: "One More Time" });

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
            trackNumber: 1,
            trackCount: 1,
            discNumber: 1,
            discCount: 1,
        },
        coverData: Buffer.from("deezer-cover"),
    });
    assert.deepEqual(
        requests.map(({ hostname, pathname }) => `${hostname}${pathname}`),
        [
            "api.deezer.com/search",
            "api.deezer.com/album/7",
            "api.deezer.com/album/7/tracks",
            "cdn.deezer.test/xl.jpg",
            "itunes.apple.com/search",
            "ws.audioscrobbler.com/2.0/",
            "ws.audioscrobbler.com/2.0/",
        ]
    );
});

const listenBrainzConfig = {
    musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
    listenBrainzToken: "test-token",
};
const numbSearch = { title: "Comfortably Numb", artist: "Pink Floyd" };
const numbMatch = {
    recording_mbid: "numb",
    recording_name: "Comfortably Numb",
    artist_credit_name: "Pink Floyd",
    release_mbid: "wall",
    release_name: "The Wall",
    metadata: {
        release: { caa_id: 42, caa_release_mbid: "wall-art" },
        tag: {
            recording: [{ tag: "progressive rock", genre_mbid: "genre" }],
        },
    },
};
const wallRelease = {
    "release-group": { "first-release-date": "1979-11-30" },
    media: [
        {
            position: 1,
            "track-count": 13,
            tracks: [{ position: 6, recording: { id: "numb" } }],
        },
    ],
};

function mockListenBrainzChain(
    responses: Record<string, unknown>,
    requests: string[] = []
): string[] {
    globalThis.fetch = withoutDeezerMatches(async (input) => {
        const url = new URL(input.toString());
        const route = `${url.hostname}${url.pathname}`;
        requests.push(route);
        return route in responses
            ? Response.json(responses[route])
            : new Response("cover", {
                  headers: { "content-type": "image/jpeg" },
              });
    });
    return requests;
}

test("findTrackMetadata completes a track with ListenBrainz and skips later providers", async () => {
    const requests = mockListenBrainzChain({
        "api.listenbrainz.org/1/metadata/lookup/": numbMatch,
        "musicbrainz.org/ws/2/release/wall": wallRelease,
    });

    const metadata = await findTrackMetadata(numbSearch, listenBrainzConfig);

    assert.deepEqual(metadata, {
        info: {
            title: "Comfortably Numb",
            artist: "Pink Floyd",
            album: "The Wall",
            year: "1979",
        },
        extras: {
            genre: "Progressive Rock",
            trackNumber: 6,
            trackCount: 13,
            discNumber: 1,
            discCount: 1,
        },
        coverData: Buffer.from("cover"),
    });
    assert.deepEqual(requests, [
        "api.listenbrainz.org/1/metadata/lookup/",
        "musicbrainz.org/ws/2/release/wall",
        "coverartarchive.org/release/wall-art/42-500",
    ]);
});

test("findTrackMetadata falls back to MusicBrainz search when ListenBrainz misses", async () => {
    const requests = mockListenBrainzChain({
        "api.listenbrainz.org/1/metadata/lookup/": {},
        "musicbrainz.org/ws/2/recording": {
            recordings: [
                {
                    title: "Comfortably Numb",
                    "artist-credit": [{ name: "Pink Floyd" }],
                    "first-release-date": "1979-11-30",
                    releases: [{ id: "wall", title: "The Wall" }],
                },
            ],
        },
        "itunes.apple.com/search": { results: [] },
    });

    const metadata = await findTrackMetadata(numbSearch, listenBrainzConfig);

    assert.equal(metadata?.info.album, "The Wall");
    assert.equal(metadata?.info.year, "1979");
    assert.deepEqual(requests.slice(0, 2), [
        "api.listenbrainz.org/1/metadata/lookup/",
        "musicbrainz.org/ws/2/recording",
    ]);
});

test("ListenBrainz release lookups and MusicBrainz searches share one rate limit", async () => {
    const { tag: _tag, ...withoutTags } = numbMatch.metadata;
    mockListenBrainzChain({
        "api.listenbrainz.org/1/metadata/lookup/": {
            ...numbMatch,
            metadata: withoutTags,
        },
        "musicbrainz.org/ws/2/release/wall": wallRelease,
        "musicbrainz.org/ws/2/recording": { recordings: [] },
        "itunes.apple.com/search": { results: [] },
    });
    const clock = createFakeClock();

    await createMetadataLookups(
        { verbose: false, ...listenBrainzConfig },
        clock,
        createRecordingLogger()
    ).chain.find({ ...numbSearch, album: "" }, emptyTags);

    assert.deepEqual(clock.sleeps, [3500]);
});

test("findTrackMetadata takes the year from iTunes after Deezer", async () => {
    mockLastFmThenDeezer([]);
    const deezerAndLastFm = globalThis.fetch;
    globalThis.fetch = async (input, init) =>
        new URL(input.toString()).hostname === "itunes.apple.com"
            ? Response.json({
                  results: [
                      {
                          trackName: "One More Time",
                          artistName: "Daft Punk",
                          collectionName: "Discovery",
                          releaseDate: "2001-03-12T08:00:00Z",
                      },
                  ],
              })
            : deezerAndLastFm(input, init);

    const metadata = await findTrackMetadata({ title: "One More Time" });

    assert.equal(metadata?.info.year, "2001");
    assert.equal(metadata?.extras.trackNumber, 1);
});
