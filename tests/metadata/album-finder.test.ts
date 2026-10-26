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

function createFinder(sources: AlbumSource[]) {
    const logger = createRecordingLogger();
    const lookups = new LookupLog({
        logger,
        clock: instantClock,
        verbose: false,
    });
    const services = createProviderServices({ logger, lookups });
    return { finder: new AlbumFinder(sources, services), logger };
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

test("AlbumFinder downloads the album cover", async () => {
    globalThis.fetch = async (input) =>
        new Response(`image ${new URL(input.toString()).pathname}`, {
            headers: { "content-type": "image/jpeg" },
        });
    const { finder } = createFinder([]);

    const cover = await finder.findCover(discovery);

    assert.deepEqual(cover, Buffer.from("image /discovery.jpg"));
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
