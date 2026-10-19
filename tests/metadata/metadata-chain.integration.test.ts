import assert from "node:assert/strict";
import { test } from "node:test";
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

    globalThis.fetch = async (input) => {
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

        return new Response(image, {
            headers: { "content-type": "image/jpeg" },
        });
    };

    let metadata;
    try {
        metadata = await findTrackMetadata(
            { title: "search query" },
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
    assert.equal(requests.length, 4);
    assert.equal(requests[3].hostname, "itunes.apple.com");
    assert.equal(requests[0].searchParams.get("track"), "search query");
    assert.equal(requests[0].searchParams.get("method"), "track.search");
    assert.equal(requests[1].searchParams.get("method"), "track.getInfo");
    assert.equal(requests[1].searchParams.get("artist"), "Matched artist");
    assert.equal(requests[1].searchParams.get("track"), "Matched title");
    assert.equal(requests[1].searchParams.get("autocorrect"), "1");
    assert.equal(requests[2].href, "https://images.example/medium.jpg");
    const trackInfoLog = output.find((line) =>
        line.startsWith("Last.fm track.getInfo URL:")
    );
    assert.ok(trackInfoLog);
    const loggedUrl = new URL(
        trackInfoLog.slice("Last.fm track.getInfo URL: ".length)
    );
    assert.equal(loggedUrl.searchParams.get("method"), "track.getInfo");
    assert.equal(loggedUrl.searchParams.get("artist"), "Matched artist");
    assert.equal(loggedUrl.searchParams.get("track"), "Matched title");
    assert.equal(loggedUrl.searchParams.get("api_key"), "[REDACTED]");
    assert.equal(trackInfoLog.includes("test-key"), false);
    assert.deepEqual(
        output.filter((line) =>
            /^(Match:|Artist:|Title:|Album:|Year:|Cover:)/.test(line)
        ),
        [
            "Match: Matched artist - Matched title",
            "Artist: Matched artist",
            "Title: Matched title",
            "Album: Matched album",
            "Year: 2024",
            "Cover: downloaded",
        ]
    );
});

test("findTrackMetadata does not log the track info URL unless verbose is enabled", async () => {
    const output: string[] = [];
    const originalConsoleLog = console.log;
    console.log = (...args: Parameters<typeof console.log>) => {
        output.push(args.map(String).join(" "));
    };
    globalThis.fetch = async (input) => {
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
    };

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

    globalThis.fetch = async (input) => {
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
    };

    await findTrackMetadata({ title: "Tubthumping", artist: "Chumbawamba" });

    assert.equal(requests[0].searchParams.get("track"), "Tubthumping");
    assert.equal(requests[0].searchParams.get("artist"), "Chumbawamba");
    assert.equal(requests[1].searchParams.get("method"), "track.getInfo");
    assert.equal(requests[1].searchParams.get("artist"), "Chumbawamba");
    assert.equal(requests[1].searchParams.get("track"), "Tubthumping");
});

test("findTrackMetadata uses MusicBrainz and Cover Art Archive when Last.fm misses data", async () => {
    const image = Buffer.from("cover-art");
    const requests: { url: URL; userAgent?: string }[] = [];

    globalThis.fetch = async (input, init) => {
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
                        title: "Different MusicBrainz title",
                        "artist-credit": [{ name: "Different artist" }],
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
    };

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

test("findTrackMetadata falls back to MusicBrainz when Last.fm has no track", async () => {
    const image = Buffer.from("cover-art");
    let musicBrainzUserAgent = "";

    globalThis.fetch = async (input, init) => {
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
    };

    assert.deepEqual(
        await findTrackMetadata(
            { title: "Tubthumping", artist: "Chumbawamba" },
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
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());

        if (url.hostname === "ws.audioscrobbler.com") {
            return Response.json({ results: { trackmatches: { track: [] } } });
        }

        if (url.hostname === "musicbrainz.org") {
            return Response.json({
                recordings: [
                    {
                        title: "Fallback title",
                        "artist-credit": [{ name: "Fallback artist" }],
                        "first-release-date": "1997-01-01",
                        releases: [{ title: "Fallback album" }],
                    },
                ],
            });
        }

        return new Response(null, { status: 404 });
    };

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

test("MusicBrainz rate limiting does not delay Last.fm requests", async () => {
    let resolveFirstMusicBrainzRequest!: () => void;
    let resolveSecondLastFmInfo!: () => void;
    const firstMusicBrainzRequest = new Promise<void>((resolve) => {
        resolveFirstMusicBrainzRequest = resolve;
    });
    const secondLastFmInfo = new Promise<void>((resolve) => {
        resolveSecondLastFmInfo = resolve;
    });
    const musicBrainzRequests: string[] = [];
    const lastFmInfoRequests: string[] = [];

    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());

        if (url.hostname === "musicbrainz.org") {
            musicBrainzRequests.push(url.href);

            if (musicBrainzRequests.length === 1) {
                resolveFirstMusicBrainzRequest();
            }

            return Response.json({ recordings: [] });
        }

        if (
            url.hostname === "ws.audioscrobbler.com" &&
            url.searchParams.get("method") === "track.search"
        ) {
            const title = url.searchParams.get("track") ?? "";
            return Response.json({
                results: {
                    trackmatches: {
                        track: { name: title, artist: "Artist" },
                    },
                },
            });
        }

        if (
            url.hostname === "ws.audioscrobbler.com" &&
            url.searchParams.get("method") === "track.getInfo"
        ) {
            const title = url.searchParams.get("track") ?? "";
            lastFmInfoRequests.push(title);

            if (title === "Second title") {
                resolveSecondLastFmInfo();
            }

            return Response.json({ track: {} });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({ results: [] });
        }

        throw new Error(`Unexpected request: ${url}`);
    };

    const chain = createTestChain({
        musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
    });
    const firstTrack = chain.find(
        { title: "First title", artist: "", album: "" },
        emptyTags
    );
    await firstMusicBrainzRequest;

    const secondTrack = chain.find(
        { title: "Second title", artist: "", album: "" },
        emptyTags
    );
    await secondLastFmInfo;

    assert.deepEqual(lastFmInfoRequests, ["First title", "Second title"]);
    assert.equal(musicBrainzRequests.length, 1);

    await Promise.all([firstTrack, secondTrack]);

    assert.equal(musicBrainzRequests.length, 2);
});

test("findTrackMetadata leaves Last.fm data intact when MusicBrainz has no result", async () => {
    globalThis.fetch = async (input) => {
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
    };

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
    globalThis.fetch = async (input) => {
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
    };

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
    assert.deepEqual(errors, [
        "MusicBrainz search failed: MusicBrainz request failed: HTTP 503",
    ]);
});

test("findTrackMetadata uses large cover art when it is below 500 KB", async () => {
    const image = Buffer.from("large-image");
    const imageRequests: string[] = [];

    globalThis.fetch = async (input) => {
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
    };

    const metadata = await findTrackMetadata({ title: "Title" });

    assert.deepEqual(metadata?.coverData, image);
    assert.deepEqual(imageRequests, ["https://images.example/large.jpg"]);
});

test("findTrackMetadata falls back to medium when large cover is not under 500 KB", async () => {
    const mediumImage = Buffer.from("medium-image");
    const imageRequests: string[] = [];

    globalThis.fetch = async (input) => {
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
    };

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

    globalThis.fetch = async (input) => {
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
    };

    const metadata = await findTrackMetadata({ title: "Title" });

    assert.deepEqual(metadata?.coverData, image);
    assert.deepEqual(imageRequests, ["https://images.example/small.jpg"]);
});

test("findTrackMetadata falls back to small cover when medium cannot be downloaded", async () => {
    const image = Buffer.from("small-image");
    const imageRequests: string[] = [];

    globalThis.fetch = async (input) => {
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
    };

    const metadata = await findTrackMetadata({ title: "Title" });

    assert.deepEqual(metadata?.coverData, image);
    assert.deepEqual(imageRequests, [
        "https://images.example/medium.jpg",
        "https://images.example/small.jpg",
    ]);
});

test("findTrackMetadata returns null when neither service has a match and fallback is unconfigured", async () => {
    let requestCount = 0;
    globalThis.fetch = async (input) => {
        requestCount++;
        const url = new URL(input.toString());
        if (url.hostname === "itunes.apple.com") {
            return Response.json({ results: [] });
        }
        return Response.json({ results: { trackmatches: { track: [] } } });
    };

    assert.equal(await findTrackMetadata({ title: "missing track" }), null);
    assert.equal(requestCount, 2);
});

test("findTrackMetadata uses iTunes to fill missing metadata and artwork", async () => {
    const cover = Buffer.from("itunes-cover");
    const requests: URL[] = [];

    globalThis.fetch = async (input) => {
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
                        trackName: "iTunes title",
                        artistName: "iTunes artist",
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
    };

    const metadata = await findTrackMetadata(
        { title: "search title", artist: "search artist" },
        { musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)" }
    );

    assert.deepEqual(metadata, {
        info: {
            title: "iTunes title",
            artist: "iTunes artist",
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
    globalThis.fetch = async (input) => {
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
    };

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
    globalThis.fetch = async (input) => {
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
    };

    const metadata = await findTrackMetadata(
        { title: "search title" },
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

    globalThis.fetch = async (input) => {
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
    };

    const metadata = await findTrackMetadata(
        { title: "search title", artist: "search artist" },
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
    globalThis.fetch = async (input) => {
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
    };
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
