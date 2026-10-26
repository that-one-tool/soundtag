import assert from "node:assert/strict";
import { test } from "node:test";
import { AlbumFinder } from "../../src/metadata/album-finder.js";
import type { AlbumSource, FoundAlbum } from "../../src/metadata/types.js";
import { LookupLog } from "../../src/shared/lookup-log.js";
import { ServiceError } from "../../src/shared/errors.js";
import { instantClock } from "../helpers/clock.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { createProviderServices } from "../helpers/metadata-chain.js";

restoreFetchAfterEach();

const search = { artist: "Daft Punk", album: "discovery" };
const discovery: FoundAlbum = {
    album: "Discovery",
    covers: [{ url: "https://covers.test/discovery.jpg" }],
};

function createSource(
    name: string,
    answer: () => Promise<FoundAlbum | null>,
    searches: string[] = []
): AlbumSource {
    return {
        name,
        findAlbum: async (albumSearch) => {
            searches.push(`${name} ${albumSearch.album}`);
            return answer();
        },
    };
}

function createFinder(
    sources: AlbumSource[],
    coverSources: AlbumSource[] = []
) {
    const logger = createRecordingLogger();
    const lookups = new LookupLog({
        logger,
        clock: instantClock,
        verbose: false,
    });
    const services = createProviderServices({ logger, lookups });
    const finder = new AlbumFinder(sources, coverSources, services);
    return { finder, logger };
}

test("AlbumFinder asks the sources in order until one finds the album", async () => {
    const searches: string[] = [];
    const { finder, logger } = createFinder([
        createSource("Deezer", async () => null, searches),
        createSource("MusicBrainz", async () => discovery, searches),
        createSource("Discogs", async () => discovery, searches),
    ]);

    assert.deepEqual(await finder.findAlbum(search), discovery);
    assert.deepEqual(searches, ["Deezer discovery", "MusicBrainz discovery"]);
    assert.deepEqual(logger.infos, [
        '  album  "discovery" · Daft Punk: Deezer no match 0.0s · MusicBrainz ✓ "Discovery" 0.0s',
    ]);
});

test("AlbumFinder looks an album up once per batch", async () => {
    const searches: string[] = [];
    const { finder, logger } = createFinder([
        createSource("Deezer", async () => discovery, searches),
    ]);

    await finder.findAlbum(search);
    const again = await finder.findAlbum({ ...search });

    assert.deepEqual(again, discovery);
    assert.deepEqual(searches, ["Deezer discovery"]);
    assert.equal(logger.infos.length, 1);
});

test("AlbumFinder moves on when a service fails", async () => {
    const { finder } = createFinder([
        createSource("Deezer", async () => {
            throw new ServiceError("Deezer request failed: HTTP 500");
        }),
        createSource("Discogs", async () => discovery),
    ]);

    assert.deepEqual(await finder.findAlbum(search), discovery);
});

test("AlbumFinder finds nothing when no source has the album", async () => {
    const { finder } = createFinder([createSource("Deezer", async () => null)]);

    assert.equal(await finder.findAlbum(search), null);
});

// Serves an image for every URL but the missing ones, and records each request.
function serveImages(
    missing: string[] = [],
    timeouts: string[] = []
): string[] {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
        const { pathname } = new URL(input.toString());
        requested.push(pathname);
        if (timeouts.includes(pathname)) {
            timeouts.splice(timeouts.indexOf(pathname), 1);
            throw new DOMException("aborted", "TimeoutError");
        }
        return missing.includes(pathname)
            ? new Response(null, { status: 404 })
            : new Response(`image ${pathname}`, {
                  headers: { "content-type": "image/jpeg" },
              });
    };
    return requested;
}

const deezerDiscovery: FoundAlbum = {
    album: "Discovery",
    covers: [{ url: "https://deezer.test/deezer-discovery.jpg" }],
};

test("AlbumFinder downloads the confirmed album's cover", async () => {
    serveImages();
    const coverSearches: string[] = [];
    const { finder } = createFinder(
        [createSource("MusicBrainz", async () => discovery)],
        [createSource("Deezer", async () => deezerDiscovery, coverSearches)]
    );

    const cover = await finder.findCover(search);

    assert.deepEqual(cover, Buffer.from("image /discovery.jpg"));
    assert.deepEqual(coverSearches, []);
});

test("AlbumFinder takes Deezer's cover when the confirmed one is missing, once per batch", async () => {
    const requested = serveImages(["/discovery.jpg"]);
    const { finder, logger } = createFinder(
        [createSource("MusicBrainz", async () => discovery)],
        [createSource("Deezer", async () => deezerDiscovery)]
    );

    const cover = await finder.findCover(search);
    const again = await finder.findCover({ ...search });

    assert.deepEqual(cover, Buffer.from("image /deezer-discovery.jpg"));
    assert.deepEqual(again, cover);
    assert.deepEqual(requested, ["/discovery.jpg", "/deezer-discovery.jpg"]);
    assert.ok(logger.infos.some((line) => line.startsWith("  cover ")));
});

test("AlbumFinder gives no cover for an album nobody confirms", async () => {
    const coverSearches: string[] = [];
    const { finder } = createFinder(
        [createSource("MusicBrainz", async () => null)],
        [createSource("Deezer", async () => deezerDiscovery, coverSearches)]
    );

    assert.equal(await finder.findCover(search), null);
    assert.deepEqual(coverSearches, []);
});

test("AlbumFinder asks again after a service failed to answer", async () => {
    let calls = 0;
    const { finder } = createFinder([
        createSource("Deezer", async () => null),
        createSource("Discogs", async () => {
            calls += 1;
            if (calls === 1) {
                throw new ServiceError("Discogs request failed: HTTP 503");
            }
            return discovery;
        }),
    ]);

    assert.equal(await finder.findAlbum(search), null);
    assert.deepEqual(await finder.findAlbum(search), discovery);
    assert.equal(calls, 2);
});

test("AlbumFinder still fails the file on a bug in a source", async () => {
    const { finder } = createFinder([
        createSource("Deezer", async () => {
            throw new TypeError("bug");
        }),
    ]);

    await assert.rejects(finder.findAlbum(search), TypeError);
});

test("AlbumFinder asks again only the services that failed", async () => {
    const searches: string[] = [];
    const { finder } = createFinder([
        createSource("Deezer", async () => null, searches),
        createSource(
            "Discogs",
            async () => {
                throw new ServiceError("Discogs request failed: HTTP 429");
            },
            searches
        ),
    ]);

    await finder.findAlbum(search);
    await finder.findAlbum(search);

    assert.deepEqual(searches, [
        "Deezer discovery",
        "Discogs discovery",
        "Discogs discovery",
    ]);
});

test("AlbumFinder takes the next cover of the album when the first is missing", async () => {
    serveImages(["/large.jpg"]);
    const { finder } = createFinder([
        createSource("MusicBrainz", async () => ({
            album: "Discovery",
            covers: [
                { url: "https://covers.test/large.jpg" },
                { url: "https://covers.test/small.jpg" },
            ],
        })),
    ]);

    assert.deepEqual(
        await finder.findCover(search),
        Buffer.from("image /small.jpg")
    );
});

test("AlbumFinder takes Deezer's cover for an album without covers", async () => {
    serveImages();
    const { finder } = createFinder(
        [createSource("Discogs", async () => ({ ...discovery, covers: [] }))],
        [createSource("Deezer", async () => deezerDiscovery)]
    );

    assert.deepEqual(
        await finder.findCover(search),
        Buffer.from("image /deezer-discovery.jpg")
    );
});

test("AlbumFinder asks for the cover again after a download timed out", async () => {
    serveImages([], ["/discovery.jpg"]);
    const { finder } = createFinder([
        createSource("MusicBrainz", async () => discovery),
    ]);

    assert.equal(await finder.findCover(search), null);
    assert.deepEqual(
        await finder.findCover(search),
        Buffer.from("image /discovery.jpg")
    );
});

test("AlbumFinder asks the backup again after it failed", async () => {
    serveImages(["/discovery.jpg"]);
    let calls = 0;
    const { finder } = createFinder(
        [createSource("MusicBrainz", async () => discovery)],
        [
            createSource("Deezer", async () => {
                calls += 1;
                if (calls === 1) {
                    throw new ServiceError("Deezer request failed: HTTP 503");
                }
                return deezerDiscovery;
            }),
        ]
    );

    assert.equal(await finder.findCover(search), null);
    assert.deepEqual(
        await finder.findCover(search),
        Buffer.from("image /deezer-discovery.jpg")
    );
});

test("AlbumFinder does not ask the service that confirmed the album for its cover again", async () => {
    const requested = serveImages(["/discovery.jpg"]);
    const searches: string[] = [];
    const deezer = createSource("Deezer", async () => discovery, searches);
    const { finder } = createFinder([deezer], [deezer]);

    assert.equal(await finder.findCover(search), null);
    assert.deepEqual(searches, ["Deezer discovery"]);
    assert.deepEqual(requested, ["/discovery.jpg"]);
});

test("AlbumFinder looks the cover up once the album is confirmed after a failure", async () => {
    serveImages();
    let calls = 0;
    const { finder } = createFinder([
        createSource("MusicBrainz", async () => {
            calls += 1;
            if (calls === 1) {
                throw new ServiceError("MusicBrainz request failed: HTTP 503");
            }
            return discovery;
        }),
    ]);

    assert.equal(await finder.findCover(search), null);
    assert.deepEqual(
        await finder.findCover(search),
        Buffer.from("image /discovery.jpg")
    );
});

test("AlbumFinder asks once per batch for a cover that is missing", async () => {
    const requested = serveImages(["/discovery.jpg", "/deezer-discovery.jpg"]);
    const searches: string[] = [];
    const { finder } = createFinder(
        [createSource("MusicBrainz", async () => discovery)],
        [createSource("Deezer", async () => deezerDiscovery, searches)]
    );

    assert.equal(await finder.findCover(search), null);
    assert.equal(await finder.findCover(search), null);
    assert.deepEqual(requested, ["/discovery.jpg", "/deezer-discovery.jpg"]);
    assert.deepEqual(searches, ["Deezer discovery"]);
});

for (const status of [503, 429]) {
    test(`AlbumFinder asks for the cover again after an HTTP ${status}`, async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls += 1;
            return calls === 1
                ? new Response(null, { status })
                : new Response("image", {
                      headers: { "content-type": "image/jpeg" },
                  });
        };
        const { finder } = createFinder([
            createSource("MusicBrainz", async () => discovery),
        ]);

        assert.equal(await finder.findCover(search), null);
        assert.deepEqual(await finder.findCover(search), Buffer.from("image"));
    });
}
