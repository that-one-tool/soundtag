import { consoleLogger } from "../../../src/shared/logger.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { LastFmProvider } from "../../../src/metadata/providers/lastfm.js";
import { captureConsole } from "../../helpers/console.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createRecordingLogger } from "../../helpers/logger.js";
import { createFakeClock, instantClock } from "../../helpers/clock.js";
import type { Clock } from "../../../src/shared/rate-limiter.js";
import type { Logger } from "../../../src/shared/logger.js";
import { LookupLog } from "../../../src/shared/lookup-log.js";
import {
    createProviderServices,
    coverNeeds,
    detailNeeds,
} from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();
const output = captureConsole();
const search = { title: "Title", artist: "Artist", album: "" };

function createLastFm(
    overrides: Partial<{ verbose: boolean; clock: Clock; logger: Logger }> = {}
): LastFmProvider {
    const { verbose, clock, logger } = {
        verbose: false,
        clock: instantClock,
        logger: consoleLogger,
        ...overrides,
    };
    const lookups = new LookupLog({ logger, clock, verbose });
    return new LastFmProvider(
        { apiKey: "key" },
        createProviderServices({ clock, logger, lookups })
    );
}

function mockLastFmMatchWithCover(requestedHosts: string[]): void {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requestedHosts.push(url.hostname);

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: { trackmatches: { track: { name: "Title" } } },
            });
        }

        return Response.json({
            track: {
                album: {
                    title: "Album",
                    image: [
                        { size: "large", "#text": "https://images.test/a.jpg" },
                    ],
                },
            },
        });
    };
}

test("LastFmProvider skips the cover download when no cover is needed", async () => {
    const requestedHosts: string[] = [];
    mockLastFmMatchWithCover(requestedHosts);

    const metadata = await createLastFm().findMetadata(search, detailNeeds);

    assert.equal(metadata?.info.album, "Album");
    assert.equal(metadata?.coverData, null);
    assert.ok(!requestedHosts.includes("images.test"));
});

test("LastFmProvider spaces its API requests but not its cover download", async () => {
    const requestedHosts: string[] = [];
    mockLastFmMatchWithCover(requestedHosts);
    const clock = createFakeClock();

    await createLastFm({ clock }).findMetadata(
        { ...search, artist: "" },
        coverNeeds
    );

    assert.ok(requestedHosts.includes("images.test"));
    assert.deepEqual(clock.sleeps, [2000]);
});

test("LastFmProvider returns null quietly when nothing matches", async () => {
    globalThis.fetch = async () =>
        Response.json({ results: { trackmatches: { track: [] } } });

    assert.equal(await createLastFm().findMetadata(search, coverNeeds), null);
    assert.deepEqual(output.logs, []);
});

test("LastFmProvider reads the first match from a result list with a plain artist", async () => {
    const requests: URL[] = [];
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requests.push(url);

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: {
                    trackmatches: {
                        track: [
                            {
                                name: "Plain Artist: Song",
                                artist: "Plain Artist",
                            },
                            { name: "Other", artist: "Other artist" },
                        ],
                    },
                },
            });
        }

        return Response.json({
            track: { album: { title: "Album", year: "1999" } },
        });
    };

    const metadata = await createLastFm().findMetadata(
        { title: "Song", artist: "", album: "" },
        detailNeeds
    );

    assert.deepEqual(metadata?.info, {
        title: "Song",
        artist: "Plain Artist",
        album: "Album",
        year: "1999",
    });
    assert.equal(requests[0].searchParams.get("method"), "track.search");
    assert.equal(requests[0].searchParams.has("artist"), false);
    assert.equal(requests[1].searchParams.get("track"), "Song");
    assert.equal(requests[1].searchParams.get("autocorrect"), "1");
});

test("LastFmProvider keeps titles that only start like the artist name", async () => {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: {
                    trackmatches: {
                        track: { name: "Abbaesque", artist: "Abba" },
                    },
                },
            });
        }

        return Response.json({});
    };

    const metadata = await createLastFm().findMetadata(
        { title: "Abbaesque", artist: "Abba", album: "" },
        detailNeeds
    );

    assert.equal(metadata?.info.title, "Abbaesque");
});

test("LastFmProvider removes a repeated artist prefix regardless of case", async () => {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: {
                    trackmatches: {
                        track: { name: "ABBA - Waterloo", artist: "Abba" },
                    },
                },
            });
        }

        return Response.json({});
    };

    const metadata = await createLastFm().findMetadata(
        { title: "Waterloo", artist: "Abba", album: "" },
        detailNeeds
    );

    assert.equal(metadata?.info.title, "Waterloo");
});

test("LastFmProvider shows its request URLs when verbose and throws a failed search", async () => {
    const logger = createRecordingLogger();
    globalThis.fetch = async () => new Response(null, { status: 500 });

    await assert.rejects(
        createLastFm({ verbose: true, logger }).findMetadata(
            search,
            coverNeeds
        ),
        /HTTP 500/
    );

    assert.deepEqual(logger.infos, [
        "         https://ws.audioscrobbler.com/2.0/?method=track.getInfo&artist=Artist&track=Title&api_key=[REDACTED]&format=json&autocorrect=1",
        "         https://ws.audioscrobbler.com/2.0/?method=track.search&track=Title&api_key=[REDACTED]&format=json&limit=1&artist=Artist",
    ]);
    assert.deepEqual(output.logs, []);
});

function mockTrackInfo(requests: URL[], track: object): void {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requests.push(url);

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: {
                    trackmatches: {
                        track: { name: "Title", artist: "The Artist" },
                    },
                },
            });
        }

        return Response.json({ track });
    };
}

test("LastFmProvider asks track.getInfo directly when the artist is known", async () => {
    const requests: URL[] = [];
    mockTrackInfo(requests, {
        name: "Title (Remastered)",
        artist: { name: "The Artist" },
        album: { title: "Album", year: "2001" },
    });

    const metadata = await createLastFm().findMetadata(search, detailNeeds);

    assert.deepEqual(metadata?.info, {
        title: "Title (Remastered)",
        artist: "The Artist",
        album: "Album",
        year: "2001",
    });
    assert.deepEqual(
        requests.map((url) => url.searchParams.get("method")),
        ["track.getInfo"]
    );
    assert.equal(requests[0].searchParams.get("artist"), "Artist");
    assert.equal(requests[0].searchParams.get("track"), "Title");
});

test("LastFmProvider falls back to track.search when the direct lookup finds no track", async () => {
    const requests: URL[] = [];
    mockTrackInfo(requests, { album: { title: "Album" } });

    const metadata = await createLastFm().findMetadata(search, detailNeeds);

    assert.deepEqual(metadata?.info, {
        title: "Title",
        artist: "The Artist",
        album: "Album",
        year: "",
    });
    assert.deepEqual(
        requests.map((url) => url.searchParams.get("method")),
        ["track.getInfo", "track.search", "track.getInfo"]
    );
});

test("LastFmProvider strips a repeated artist from the title it asks directly", async () => {
    const requests: URL[] = [];
    mockTrackInfo(requests, { name: "Title", album: { title: "Album" } });

    await createLastFm().findMetadata(
        { ...search, title: "Artist - Title" },
        detailNeeds
    );

    assert.equal(requests[0].searchParams.get("track"), "Title");
});

test("LastFmProvider falls back to track.search when the direct hit has no album", async () => {
    const requests: URL[] = [];
    mockTrackInfo(requests, { name: "Title", artist: { name: "Artist" } });

    await createLastFm().findMetadata(search, detailNeeds);

    assert.deepEqual(
        requests.map((url) => url.searchParams.get("method")),
        ["track.getInfo", "track.search", "track.getInfo"]
    );
});

test("LastFmProvider does not ask track.getInfo twice for the same track", async () => {
    const requests: URL[] = [];
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requests.push(url);
        return url.searchParams.get("method") === "track.search"
            ? Response.json({
                  results: {
                      trackmatches: {
                          track: { name: "Title", artist: "Artist" },
                      },
                  },
              })
            : Response.json({ track: { name: "Title" } });
    };

    const metadata = await createLastFm().findMetadata(search, detailNeeds);

    assert.equal(metadata?.info.title, "Title");
    assert.deepEqual(
        requests.map((url) => url.searchParams.get("method")),
        ["track.getInfo", "track.search"]
    );
});

test("LastFmProvider falls back silently and spaced when the direct lookup fails", async () => {
    const logger = createRecordingLogger();
    const clock = createFakeClock();
    let infoCalls = 0;
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());

        if (url.searchParams.get("method") === "track.search") {
            return Response.json({
                results: {
                    trackmatches: {
                        track: { name: "Title", artist: "The Artist" },
                    },
                },
            });
        }

        infoCalls += 1;
        return infoCalls === 1
            ? new Response(null, { status: 500 })
            : Response.json({ track: { album: { title: "Album" } } });
    };

    const metadata = await createLastFm({ clock, logger }).findMetadata(
        search,
        detailNeeds
    );

    assert.equal(metadata?.info.album, "Album");
    assert.deepEqual(logger.errors, []);
    assert.deepEqual(clock.sleeps, [2000, 2000]);
});

test("LastFmProvider falls back to track.search when the direct hit is another song", async () => {
    const requests: URL[] = [];
    mockTrackInfo(requests, {
        name: "Other Song",
        artist: { name: "Artist" },
        album: { title: "Other Album" },
    });

    const metadata = await createLastFm().findMetadata(search, detailNeeds);

    assert.equal(metadata?.info.title, "Title");
    assert.deepEqual(
        requests.map((url) => url.searchParams.get("method")),
        ["track.getInfo", "track.search", "track.getInfo"]
    );
});

test("LastFmProvider returns null without track details when the search finds another song", async () => {
    const requests: URL[] = [];
    globalThis.fetch = async (input) => {
        requests.push(new URL(input.toString()));
        return Response.json({
            results: {
                trackmatches: { track: { name: "Other Song", artist: "Band" } },
            },
        });
    };

    const metadata = await createLastFm().findMetadata(
        { ...search, artist: "" },
        detailNeeds
    );

    assert.equal(metadata, null);
    assert.equal(requests.length, 1);
});

test("LastFmProvider keeps no album from a direct hit that is another song", async () => {
    const requests: URL[] = [];
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requests.push(url);
        return url.searchParams.get("method") === "track.search"
            ? Response.json({
                  results: {
                      trackmatches: {
                          track: { name: "Title", artist: "Artist" },
                      },
                  },
              })
            : Response.json({
                  track: { name: "Other Song", album: { title: "Other" } },
              });
    };

    const metadata = await createLastFm().findMetadata(search, detailNeeds);

    assert.equal(metadata?.info.title, "Title");
    assert.equal(metadata?.info.album, "");
    assert.equal(requests.length, 2);
});
