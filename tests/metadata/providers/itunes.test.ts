import { consoleLogger } from "../../../src/shared/logger.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ItunesProvider } from "../../../src/metadata/providers/itunes.js";
import { instantClock } from "../../helpers/clock.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createRecordingLogger } from "../../helpers/logger.js";
import type { Clock } from "../../../src/shared/rate-limiter.js";
import { createProviderServices } from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();

test("ItunesProvider skips the artwork download when no cover is needed", async () => {
    const requestedHosts: string[] = [];
    globalThis.fetch = async (input) => {
        requestedHosts.push(new URL(input.toString()).hostname);
        return Response.json({
            results: [
                {
                    trackName: "Title",
                    artworkUrl100: "https://artwork.test/cover.jpg",
                },
            ],
        });
    };

    const metadata = await new ItunesProvider(
        createProviderServices()
    ).findMetadata({ title: "Title", artist: "", album: "" }, false);

    assert.equal(metadata?.info.title, "Title");
    assert.equal(metadata?.coverData, null);
    assert.deepEqual(requestedHosts, ["itunes.apple.com"]);
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
    const provider = new ItunesProvider(
        createProviderServices({ clock, logger: consoleLogger })
    );
    const search = { title: "title", artist: "artist", album: "" };

    await Promise.all([
        provider.findMetadata(search, true),
        provider.findMetadata(search, true),
    ]);

    assert.equal(requestCount, 2);
    assert.deepEqual(sleeps, [4000]);
});

test("ItunesProvider logs failures to the injected logger", async () => {
    const logger = createRecordingLogger();
    globalThis.fetch = async () => new Response(null, { status: 500 });

    await new ItunesProvider(
        createProviderServices({ clock: instantClock, logger })
    ).findMetadata({ title: "Title", artist: "", album: "" }, false);

    assert.deepEqual(logger.errors, [
        "iTunes Search failed: iTunes Search request failed: HTTP 500",
    ]);
});

const itunesRelease = {
    trackName: "Title",
    collectionName: "Back in Black",
    primaryGenreName: "Hard Rock",
    collectionArtistName: "AC/DC",
    trackNumber: 6,
    trackCount: 10,
    discNumber: 1,
    discCount: 1,
};

function findItunesExtras(
    album: string,
    track: object = itunesRelease,
    artist = ""
) {
    globalThis.fetch = async () => Response.json({ results: [track] });
    return new ItunesProvider(createProviderServices())
        .findMetadata({ title: "Title", artist, album }, false)
        .then((metadata) => metadata?.extras);
}

test("ItunesProvider takes release extras when the album matches", async () => {
    assert.deepEqual(await findItunesExtras(" back in black "), {
        genre: "Hard Rock",
        albumArtist: "AC/DC",
        trackNumber: 6,
        trackCount: 10,
        discNumber: 1,
        discCount: 1,
    });
});

test("ItunesProvider takes release extras when no album is known", async () => {
    assert.equal((await findItunesExtras(""))?.trackNumber, 6);
});

test("ItunesProvider keeps only the genre when the album differs", async () => {
    assert.deepEqual(await findItunesExtras("Greatest Hits"), {
        genre: "Hard Rock",
    });
});

test("ItunesProvider leaves out extras iTunes does not provide", async () => {
    const extras = await findItunesExtras("", { trackName: "Title" });

    assert.deepEqual(extras, {});
});

test("ItunesProvider takes no extras from a different song", async () => {
    const karaoke = { ...itunesRelease, trackName: "Other song" };

    assert.deepEqual(await findItunesExtras("", karaoke), {});
});

test("ItunesProvider takes no extras from a different artist", async () => {
    const cover = { ...itunesRelease, artistName: "Karaoke Band" };

    assert.deepEqual(await findItunesExtras("", cover, "AC/DC"), {});
});

test("ItunesProvider matches names loosely", async () => {
    const remaster = {
        ...itunesRelease,
        trackName: "TITLE (Remastered 2009)",
        artistName: "AC-DC",
    };

    const extras = await findItunesExtras("", remaster, "ac/dc");

    assert.equal(extras?.genre, "Hard Rock");
});

test("ItunesProvider takes no extras from a karaoke version", async () => {
    const karaoke = { ...itunesRelease, trackName: "Title (Karaoke Version)" };

    assert.deepEqual(await findItunesExtras("", karaoke), {});
});

test("ItunesProvider takes no extras from a live version of the artist", async () => {
    const live = {
        ...itunesRelease,
        trackName: "Title (Live)",
        artistName: "AC/DC",
    };

    assert.deepEqual(await findItunesExtras("", live, "AC/DC"), {});
});

test("ItunesProvider ignores accents and featured artists in names", async () => {
    const featured = {
        ...itunesRelease,
        trackName: "Title [feat. Jay-Z]",
        artistName: "Beyoncé",
    };

    const extras = await findItunesExtras("", featured, "Beyonce");

    assert.equal(extras?.genre, "Hard Rock");
});
