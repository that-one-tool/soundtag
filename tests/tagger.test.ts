import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import NodeID3 from "node-id3";
import { File as TagLibFile } from "node-taglib-sharp";
import { afterEach, test } from "node:test";
import { getTagStore, isProperlyTagged } from "../src/audio-tags.js";
import {
    createMetadataChain,
    type MetadataChainConfig,
} from "../src/create-metadata-chain.js";
import { ItunesProvider } from "../src/itunes.js";
import type { MetadataChain } from "../src/metadata-chain.js";
import { processTrack } from "../src/processing.js";
import type { Clock } from "../src/rate-limiter.js";
import type {
    ProcessingReport,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../src/types.js";

const originalFetch = globalThis.fetch;
const temporaryDirectories: string[] = [];

afterEach(async () => {
    globalThis.fetch = originalFetch;
    await Promise.all(
        temporaryDirectories
            .splice(0)
            .map((directory) =>
                fs.rm(directory, { recursive: true, force: true })
            )
    );
});

const instantClock: Clock = { now: () => 0, sleep: async () => undefined };
const emptyInfo: TrackInfo = { title: "", artist: "", album: "", year: "" };

function createTestChain(
    config: Partial<MetadataChainConfig> = {}
): MetadataChain {
    return createMetadataChain(
        { lastFmApiKey: "test-key", verbose: false, ...config },
        instantClock
    );
}

function findTrackMetadata(
    search: Partial<TrackSearch>,
    config: Partial<MetadataChainConfig> = {},
    existingInfo: TrackInfo = emptyInfo
): Promise<TrackMetadata | null> {
    return createTestChain(config).find(
        { title: "", artist: "", album: "", ...search },
        existingInfo
    );
}

async function createTemporaryDirectory(): Promise<string> {
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "soundtag-tagger-test-")
    );
    temporaryDirectories.push(directory);
    return directory;
}

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
        coverData: image,
    });
    assert.equal(requests.length, 3);
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
        emptyInfo
    );
    await firstMusicBrainzRequest;

    const secondTrack = chain.find(
        { title: "Second title", artist: "", album: "" },
        emptyInfo
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
        coverData: null,
    });
    assert.ok(requests.some(({ hostname }) => hostname === "itunes.apple.com"));
    assert.equal(
        requests.some(({ hostname }) => hostname === "www.googleapis.com"),
        false
    );
});

test("iTunes searches are rate-limited when requests run concurrently", async () => {
    let requestCount = 0;
    const sleeps: number[] = [];
    const clock: Clock = {
        now: () => 0,
        sleep: async (milliseconds) => sleeps.push(milliseconds),
    };
    globalThis.fetch = async (input) => {
        assert.equal(new URL(input.toString()).hostname, "itunes.apple.com");
        requestCount++;
        return Response.json({ results: [] });
    };
    const provider = new ItunesProvider(clock);
    const search = { title: "title", artist: "artist", album: "" };

    await Promise.all([
        provider.findMetadata(search, true),
        provider.findMetadata(search, true),
    ]);

    assert.equal(requestCount, 2);
    assert.deepEqual(sleeps, [3000]);
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

test("processTrack writes OGG Vorbis comments and embedded cover art", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Artist - Title.ogg");
    const fixture = path.join(process.cwd(), "tests/fixtures/silent.ogg");
    const cover = Buffer.from("test-cover-data");
    await fs.copyFile(fixture, source);

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
                        year: "2024",
                        image: [
                            {
                                size: "medium",
                                "#text": "https://images.example/cover.jpg",
                            },
                        ],
                    },
                },
            });
        }

        return new Response(cover, {
            headers: { "content-type": "image/jpeg" },
        });
    };

    const stats = { ok: 0, skipped: 0, errors: 0 };
    const report = { files: {} };
    await processTrack(
        source,
        directory,
        createTestChain(),
        stats,
        report,
        1,
        1
    );

    const file = TagLibFile.createFromPath(source);
    try {
        assert.equal(file.tag.title, "Title");
        assert.deepEqual(file.tag.performers, ["Artist"]);
        assert.equal(file.tag.album, "Album");
        assert.equal(file.tag.year, 2024);
        assert.equal(file.tag.pictures.length, 1);
        assert.deepEqual(
            Buffer.from(file.tag.pictures[0].data.toByteArray()),
            cover
        );
    } finally {
        file.dispose();
    }

    assert.equal(
        isProperlyTagged(await getTagStore(source).read(source)),
        true
    );
    assert.deepEqual(stats, { ok: 1, skipped: 0, errors: 0 });
    assert.deepEqual(report, { files: { "Artist - Title.ogg": "TAGGED" } });
});

test("processTrack combines embedded tags with artist and album folder context", async () => {
    const directory = await createTemporaryDirectory();
    const sourceDirectory = path.join(
        directory,
        "Folder Artist",
        "2020 - Folder Album"
    );
    const source = path.join(sourceDirectory, "01 - Filename Title.mp3");
    await fs.mkdir(sourceDirectory, { recursive: true });
    await fs.writeFile(source, "audio bytes");
    assert.equal(
        NodeID3.write(
            { title: "Embedded title", artist: "Tagged artist" },
            source
        ),
        true
    );
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
                                name: "API title",
                                artist: "API artist",
                            },
                        },
                    },
                });
            }
            return Response.json({ track: {} });
        }

        if (url.hostname === "musicbrainz.org") {
            return Response.json({ recordings: [] });
        }

        if (url.hostname === "itunes.apple.com") {
            return Response.json({
                results: [
                    {
                        trackName: "API title",
                        artistName: "API artist",
                        collectionName: "API album",
                        releaseDate: "2020-01-01",
                    },
                ],
            });
        }

        throw new Error(`Unexpected request: ${url}`);
    };

    const stats = { ok: 0, skipped: 0, errors: 0 };
    const report = { files: {} };
    await processTrack(
        source,
        directory,
        createTestChain({
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
        }),
        stats,
        report,
        1,
        1
    );

    const lastFmSearch = requests.find(
        ({ hostname, searchParams }) =>
            hostname === "ws.audioscrobbler.com" &&
            searchParams.get("method") === "track.search"
    );
    assert.ok(lastFmSearch);
    assert.equal(lastFmSearch.searchParams.get("track"), "Embedded title");
    assert.equal(lastFmSearch.searchParams.get("artist"), "Tagged artist");
    const musicBrainzSearch = requests.find(
        ({ hostname }) => hostname === "musicbrainz.org"
    );
    assert.ok(musicBrainzSearch);
    assert.equal(
        musicBrainzSearch.searchParams.get("query"),
        'recording:"Embedded title" AND artist:"Tagged artist" AND release:"Folder Album"'
    );
    const itunesSearch = requests.find(
        ({ hostname }) => hostname === "itunes.apple.com"
    );
    assert.ok(itunesSearch);
    assert.equal(
        itunesSearch.searchParams.get("term"),
        "Tagged artist Embedded title Folder Album"
    );

    const tags = await NodeID3.Promise.read(source);
    assert.equal(tags.title, "Embedded title");
    assert.equal(tags.artist, "Tagged artist");
    assert.equal(tags.album, "API album");
    assert.equal(tags.year, "2020");
    assert.deepEqual(stats, { ok: 1, skipped: 0, errors: 0 });
});

test("processTrack writes available tags when year and cover art are unavailable", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Artist - Title.mp3");
    await fs.writeFile(source, "audio bytes");

    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());

        if (url.hostname !== "ws.audioscrobbler.com") {
            return Response.json({ recordings: [] });
        }

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: {
                    trackmatches: {
                        track: { name: "Title", artist: "Artist" },
                    },
                },
            });
        }

        return Response.json({ track: { album: { title: "Album" } } });
    };

    const stats = { ok: 0, skipped: 0, errors: 0 };
    const report = { files: {} };
    await processTrack(
        source,
        directory,
        createTestChain({
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
        }),
        stats,
        report,
        1,
        1
    );

    const tags = await NodeID3.Promise.read(source);
    assert.equal(tags.title, "Title");
    assert.equal(tags.artist, "Artist");
    assert.equal(tags.album, "Album");
    assert.equal(tags.year?.trim() ?? "", "");
    assert.equal(tags.image, undefined);
    assert.deepEqual(stats, { ok: 1, skipped: 0, errors: 0 });
    assert.deepEqual(report, { files: { "Artist - Title.mp3": "TAGGED" } });
});

test("processTrack marks unreadable audio files as failed", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "broken.flac");
    await fs.writeFile(source, "not really flac");
    const stats = { ok: 0, skipped: 0, errors: 0 };
    const report: ProcessingReport = { files: {} };
    const originalConsoleError = console.error;
    console.error = () => {};
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(null, { status: 500 });
    };

    try {
        await processTrack(
            source,
            directory,
            createTestChain(),
            stats,
            report,
            1,
            1
        );
    } finally {
        console.error = originalConsoleError;
    }

    assert.deepEqual(stats, { ok: 0, skipped: 0, errors: 1 });
    assert.deepEqual(report, { files: { "broken.flac": "FAILED" } });
    assert.equal(fetchCalls, 0);
});
