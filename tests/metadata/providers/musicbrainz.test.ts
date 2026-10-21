import assert from "node:assert/strict";
import { test } from "node:test";
import { MusicBrainzClient } from "../../../src/metadata/providers/musicbrainz-client.js";
import { MusicBrainzProvider } from "../../../src/metadata/providers/musicbrainz.js";
import type { ProviderServices } from "../../../src/metadata/types.js";
import { createFakeClock } from "../../helpers/clock.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createRecordingLogger } from "../../helpers/logger.js";
import {
    coverNeeds,
    createProviderServices,
    detailNeeds,
} from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();
const search = { title: "Title", artist: "Artist", album: "" };

function createProvider(services: Partial<ProviderServices> = {}) {
    const providerServices = createProviderServices({
        clock: createFakeClock(),
        logger: createRecordingLogger(),
        ...services,
    });
    return new MusicBrainzProvider(
        new MusicBrainzClient(
            "SoundTag/1.0 (test@example.com)",
            providerServices
        ),
        providerServices
    );
}

const searchedRecording = {
    title: "Title",
    "artist-credit": [{ name: "Artist" }],
};

function mockMusicBrainz(recordings: object[], requested: string[] = []) {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requested.push(url.hostname);
        return url.hostname === "musicbrainz.org"
            ? Response.json({ recordings })
            : new Response("cover", {
                  headers: { "content-type": "image/jpeg" },
              });
    };
    return requested;
}

test("MusicBrainzProvider takes info from the first recording", async () => {
    mockMusicBrainz([
        {
            title: "Found",
            "artist-credit": [
                { name: "A", joinphrase: " & " },
                { artist: { name: "B" } },
            ],
            "first-release-date": "1979-11-30",
            releases: [{ id: "release", title: "Album", date: "1984" }],
        },
    ]);

    const metadata = await createProvider().findMetadata(
        { title: "Found", artist: "A & B", album: "" },
        detailNeeds
    );

    assert.deepEqual(metadata?.info, {
        title: "Found",
        artist: "A & B",
        album: "Album",
        year: "1979",
    });
});

test("MusicBrainzProvider downloads the first release cover", async () => {
    const requested = mockMusicBrainz([
        { ...searchedRecording, releases: [{ id: "release" }] },
    ]);

    const metadata = await createProvider().findMetadata(search, coverNeeds);

    assert.deepEqual(metadata?.coverData, Buffer.from("cover"));
    assert.deepEqual(requested, ["musicbrainz.org", "coverartarchive.org"]);
});

test("MusicBrainzProvider skips the cover download when no cover is needed", async () => {
    const requested = mockMusicBrainz([
        { ...searchedRecording, releases: [{ id: "release" }] },
    ]);

    const metadata = await createProvider().findMetadata(search, detailNeeds);

    assert.equal(metadata?.coverData, null);
    assert.deepEqual(requested, ["musicbrainz.org"]);
});

test("MusicBrainzProvider returns null for another song", async () => {
    mockMusicBrainz([
        {
            title: "Title (Karaoke Version)",
            "artist-credit": [{ name: "Artist" }],
        },
    ]);

    assert.equal(await createProvider().findMetadata(search, coverNeeds), null);
});

test("MusicBrainzProvider rejects a recording released only by another artist", async () => {
    mockMusicBrainz([
        {
            ...searchedRecording,
            releases: [
                {
                    id: "cover-ep",
                    title: "Undercover, Vol. 2",
                    "artist-credit": [{ name: "Tribute Band" }],
                },
            ],
        },
    ]);

    assert.equal(await createProvider().findMetadata(search, coverNeeds), null);
});

test("MusicBrainzProvider takes the album and cover of the searched release", async () => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requested.push(`${url.hostname}${url.pathname}`);
        return url.hostname === "musicbrainz.org"
            ? Response.json({
                  recordings: [
                      {
                          ...searchedRecording,
                          releases: [
                              { id: "single", title: "Title" },
                              {
                                  id: "tribute",
                                  title: "Album",
                                  "artist-credit": [{ name: "Tribute Band" }],
                              },
                              {
                                  id: "album",
                                  title: "Album",
                                  "artist-credit": [{ name: "Artist" }],
                              },
                          ],
                      },
                  ],
              })
            : new Response("cover", {
                  headers: { "content-type": "image/jpeg" },
              });
    };

    const metadata = await createProvider().findMetadata(
        { ...search, album: "Album" },
        coverNeeds
    );

    assert.equal(metadata?.info.album, "Album");
    assert.deepEqual(requested, [
        "musicbrainz.org/ws/2/recording",
        "coverartarchive.org/release/album/front-500",
    ]);
});

test("MusicBrainzProvider leaves out the album and cover of another release", async () => {
    const requested = mockMusicBrainz([
        { ...searchedRecording, releases: [{ id: "single", title: "Title" }] },
    ]);

    const metadata = await createProvider().findMetadata(
        { ...search, album: "Album" },
        coverNeeds
    );

    assert.equal(metadata?.info.album, "");
    assert.equal(metadata?.coverData, null);
    assert.deepEqual(requested, ["musicbrainz.org"]);
});

test("MusicBrainzProvider returns null when nothing is found", async () => {
    mockMusicBrainz([]);

    assert.equal(await createProvider().findMetadata(search, coverNeeds), null);
});

test("MusicBrainzProvider logs failures to the injected logger", async () => {
    const logger = createRecordingLogger();
    globalThis.fetch = async () => new Response(null, { status: 500 });

    await createProvider({ logger }).findMetadata(search, detailNeeds);

    assert.deepEqual(logger.errors, [
        "MusicBrainz search failed: MusicBrainz request failed: HTTP 500",
    ]);
});

test("MusicBrainzProvider gives the canonical spelling and first release year", async () => {
    const requested = mockMusicBrainz([
        {
            title: "Dancing Queen",
            "artist-credit": [{ name: "ABBA" }],
            "first-release-date": "1976-08-16",
            releases: [{ id: "gold", title: "Gold", date: "1992" }],
        },
    ]);

    const canonical = await createProvider().findCanonical({
        title: "dancing queen",
        artist: "Abba",
        album: "Gold",
    });

    assert.deepEqual(canonical, {
        title: "Dancing Queen",
        artist: "ABBA",
        firstReleaseYear: "1976",
    });
    assert.deepEqual(requested, ["musicbrainz.org"]);
});

test("MusicBrainzProvider gives no release year as the first release year", async () => {
    mockMusicBrainz([
        { ...searchedRecording, releases: [{ id: "gold", date: "1992" }] },
    ]);

    const canonical = await createProvider().findCanonical(search);

    assert.equal(canonical?.firstReleaseYear, "");
});

test("MusicBrainzProvider gives no canonical track for another song", async () => {
    mockMusicBrainz([
        {
            title: "Title (Karaoke Version)",
            "artist-credit": [{ name: "Artist" }],
        },
    ]);

    assert.equal(await createProvider().findCanonical(search), null);
});

test("MusicBrainzProvider needs an artist to give a canonical track", async () => {
    const requested = mockMusicBrainz([searchedRecording]);

    const canonical = await createProvider().findCanonical({
        ...search,
        artist: "",
    });

    assert.equal(canonical, null);
    assert.deepEqual(requested, []);
});
