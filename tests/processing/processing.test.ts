import { Id3TagStore } from "../../src/tags/id3-tag-store.js";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import NodeID3 from "node-id3";
import { File as TagLibFile } from "node-taglib-sharp";
import { test } from "node:test";
import { getTagStore, isProperlyTagged } from "../../src/tags/audio-tags.js";
import {
    buildTrackSearch,
    processTrack,
} from "../../src/processing/processing.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import { captureConsole } from "../helpers/console.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { consoleLogger } from "../../src/shared/logger.js";
import {
    createProviderServices,
    createTestChain,
    emptyInfo,
} from "../helpers/metadata-chain.js";
import { MetadataChain } from "../../src/metadata/metadata-chain.js";
import { TrackCorrector } from "../../src/metadata/track-corrector.js";
import type {
    CanonicalTrack,
    ProviderNeeds,
    TrackExtras,
    TrackMetadata,
    TrackSearch,
} from "../../src/metadata/types.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

restoreFetchAfterEach();
const output = captureConsole();
const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-processing-test-"
);

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

        if (url.hostname === "itunes.apple.com") {
            return Response.json({
                results: [
                    {
                        trackName: "Title",
                        artistName: "Artist",
                        primaryGenreName: "Rock",
                    },
                ],
            });
        }

        return new Response(cover, {
            headers: { "content-type": "image/jpeg" },
        });
    };

    const { status } = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createTestChain(),
    });

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
    assert.equal(status, "TAGGED");
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
                        trackName: "Embedded title",
                        artistName: "Tagged artist",
                        collectionName: "Folder Album",
                        releaseDate: "2020-01-01",
                    },
                ],
            });
        }

        throw new Error(`Unexpected request: ${url}`);
    };

    const { status } = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createTestChain({
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
        }),
    });

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
    assert.equal(tags.album, "Folder Album");
    assert.equal(tags.year, "2020");
    assert.equal(status, "TAGGED");
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

    const { status } = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createTestChain({
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
        }),
    });

    const tags = await NodeID3.Promise.read(source);
    assert.equal(tags.title, "Title");
    assert.equal(tags.artist, "Artist");
    assert.equal(tags.album, "Album");
    assert.equal(tags.year?.trim() ?? "", "");
    assert.equal(tags.image, undefined);
    assert.equal(status, "TAGGED");
});

test("processTrack marks unreadable audio files as failed without searching", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "broken.flac");
    await fs.writeFile(source, "not really flac");
    let fetchCalls = 0;
    globalThis.fetch = async () => {
        fetchCalls++;
        return new Response(null, { status: 500 });
    };

    const { status, tags } = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createTestChain(),
    });

    assert.equal(status, "FAILED");
    assert.equal(tags, null);
    assert.equal(fetchCalls, 0);
    assert.ok(
        output.errors.some((line) => line.startsWith("Processing error: "))
    );
});

test("processTrack skips files that are already properly tagged", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "tagged.mp3");
    await fs.writeFile(source, "audio bytes");
    await getTagStore(source).write(source, {
        info: { title: "Title", artist: "Artist", album: "", year: "2024" },
        extras: { genre: "Rock" },
        coverData: Buffer.from("cover"),
    });
    globalThis.fetch = async () => {
        throw new Error("no lookup expected");
    };

    assert.equal(
        (
            await processTrack(source, {
                sourceRoot: directory,
                logger: consoleLogger,
                metadataChain: createTestChain(),
            })
        ).status,
        "SKIPPED"
    );
    assert.ok(output.logs.includes("  skip   already tagged"));
});

test("processTrack skips tracks no provider can identify", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Unknown.mp3");
    await fs.writeFile(source, "audio bytes");
    globalThis.fetch = async (input) =>
        new URL(input.toString()).hostname === "itunes.apple.com"
            ? Response.json({ results: [] })
            : Response.json({ results: { trackmatches: { track: [] } } });

    assert.equal(
        (
            await processTrack(source, {
                sourceRoot: directory,
                logger: consoleLogger,
                metadataChain: createTestChain(),
            })
        ).status,
        "SKIPPED"
    );
    assert.ok(output.logs.includes("  skip   not found"));
});

test("processTrack skips matches without a title and artist", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Untitled.mp3");
    await fs.writeFile(source, "audio bytes");
    const albumOnlyChain = new MetadataChain(
        [
            {
                name: "Fake",
                findMetadata: async () => ({
                    info: { ...emptyInfo, album: "Album only" },
                    extras: {},
                    coverData: null,
                }),
            },
        ],
        [],
        createProviderServices()
    );

    assert.equal(
        (
            await processTrack(source, {
                sourceRoot: directory,
                logger: consoleLogger,
                metadataChain: albumOnlyChain,
            })
        ).status,
        "SKIPPED"
    );
    assert.ok(output.logs.includes("  skip   no title or artist found"));
});

test("buildTrackSearch prefers embedded tags, then filename, then folders", () => {
    const root = path.resolve("library");
    const source = path.join(
        root,
        "Folder Artist",
        "Folder Album",
        "File Artist - File Title.mp3"
    );

    assert.deepEqual(buildTrackSearch(source, root, emptyInfo), {
        title: "File Title",
        artist: "File Artist",
        album: "Folder Album",
    });
    assert.deepEqual(
        buildTrackSearch(
            path.join(root, "Folder Artist", "Folder Album", "Title.mp3"),
            root,
            emptyInfo
        ),
        { title: "Title", artist: "Folder Artist", album: "Folder Album" }
    );
    assert.deepEqual(
        buildTrackSearch(source, root, {
            title: "Tag Title",
            artist: "Tag Artist",
            album: "Tag Album",
            year: "",
        }),
        { title: "Tag Title", artist: "Tag Artist", album: "Tag Album" }
    );
    assert.deepEqual(
        buildTrackSearch(path.join(root, "Title.mp3"), root, emptyInfo),
        {
            title: "Title",
            artist: "",
            album: "",
        }
    );
});

test("processTrack logs its search and the metadata it could not find", async () => {
    const directory = await createTemporaryDirectory();
    const albumDirectory = path.join(directory, "Folder Album");
    await fs.mkdir(albumDirectory);
    const source = path.join(albumDirectory, "Artist - Title.mp3");
    await fs.writeFile(source, "audio bytes");
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

        return url.hostname === "itunes.apple.com"
            ? Response.json({ results: [] })
            : Response.json({ track: {} });
    };

    assert.equal(
        (
            await processTrack(source, {
                sourceRoot: directory,
                logger: consoleLogger,
                metadataChain: createTestChain(),
            })
        ).status,
        "TAGGED"
    );
    const lines = output.logs.slice(
        output.logs.indexOf("  tags   – · – · – · –")
    );
    assert.equal(lines[0], "  tags   – · – · – · –");
    assert.match(
        lines[1],
        /^ {2}search "Title" · Artist · Folder Album: .*Last\.fm ✓ title, artist /
    );
    assert.deepEqual(lines.slice(2), [
        '  write  title "Title" · artist "Artist" (missing: album, year, genre, track number, cover art)',
    ]);
});

test("processTrack logs to the context logger", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "broken.flac");
    await fs.writeFile(source, "not really flac");
    const logger = createRecordingLogger();

    await processTrack(source, {
        sourceRoot: directory,
        metadataChain: createTestChain({
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
            listenBrainzToken: "test-token",
        }),
        logger,
    });

    assert.equal(logger.errors.length, 1);
    assert.match(logger.errors[0], /^Processing error: /);
    assert.deepEqual(output.errors, []);
});

test("processTrack adds a missing genre and keeps the existing tags and cover", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "tagged.mp3");
    const cover = Buffer.from("existing cover");
    await fs.writeFile(source, "audio bytes");
    await getTagStore(source).write(source, {
        info: {
            title: "Title",
            artist: "Artist",
            album: "Album",
            year: "2024",
        },
        extras: { trackNumber: 2 },
        coverData: cover,
    });
    globalThis.fetch = async (input) =>
        new URL(input.toString()).hostname === "itunes.apple.com"
            ? Response.json({
                  results: [
                      {
                          trackName: "Title",
                          artistName: "Artist",
                          collectionName: "Album",
                          primaryGenreName: "Rock",
                          trackNumber: 7,
                          artworkUrl100: "https://artwork.test/cover.jpg",
                      },
                  ],
              })
            : Response.json({ results: { trackmatches: { track: [] } } });

    const result = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createTestChain(),
    });
    const { status } = result;

    assert.equal(status, "TAGGED");
    assert.deepEqual(result.tags, await getTagStore(source).read(source));
    const tags = await NodeID3.Promise.read(source);
    assert.equal(tags.title, "Title");
    assert.equal(tags.genre, "Rock");
    assert.equal(tags.trackNumber, "2");
    assert.ok(typeof tags.image === "object");
    assert.deepEqual(tags.image.imageBuffer, cover);
    assert.ok(!output.logs.some((line) => line.includes("cover")));
});

test("processTrack keeps every existing genre of a re-tagged FLAC", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Artist - Title.flac");
    await fs.copyFile(
        path.join(process.cwd(), "tests/fixtures/silent.flac"),
        source
    );
    const file = TagLibFile.createFromPath(source);
    try {
        file.tag.title = "Title";
        file.tag.performers = ["Artist"];
        file.tag.genres = ["Rock", "Pop"];
        file.save();
    } finally {
        file.dispose();
    }
    globalThis.fetch = async (input) =>
        new URL(input.toString()).hostname === "itunes.apple.com"
            ? Response.json({
                  results: [
                      {
                          trackName: "Title",
                          artistName: "Artist",
                          primaryGenreName: "Metal",
                          releaseDate: "2001-01-01",
                      },
                  ],
              })
            : Response.json({ results: { trackmatches: { track: [] } } });

    await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createTestChain(),
    });

    const tagged = TagLibFile.createFromPath(source);
    try {
        assert.deepEqual(tagged.tag.genres, ["Rock", "Pop"]);
        assert.equal(tagged.tag.year, 2001);
    } finally {
        tagged.dispose();
    }
});

test("processTrack leaves a file unchanged when the services add nothing new", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "tagged.mp3");
    await fs.writeFile(source, "audio bytes");
    await getTagStore(source).write(source, {
        info: {
            title: "Title",
            artist: "Artist",
            album: "Album",
            year: "2024",
        },
        extras: {},
        coverData: Buffer.from("cover"),
    });
    const before = await fs.readFile(source);
    globalThis.fetch = async (input) =>
        new URL(input.toString()).hostname === "itunes.apple.com"
            ? Response.json({
                  results: [{ trackName: "Title", artistName: "Artist" }],
              })
            : Response.json({ results: { trackmatches: { track: [] } } });

    const { status } = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createTestChain(),
    });

    assert.equal(status, "SKIPPED");
    assert.deepEqual(await fs.readFile(source), before);
    assert.ok(output.logs.includes("  skip   nothing new"));
});

test("processTrack returns the tags it read from a skipped track", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "tagged.mp3");
    await fs.writeFile(source, "audio bytes");
    await getTagStore(source).write(source, {
        info: { title: "Title", artist: "Artist", album: "", year: "2024" },
        extras: { genre: "Rock" },
        coverData: Buffer.from("cover"),
    });

    const result = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createTestChain(),
    });

    assert.deepEqual(result, {
        status: "SKIPPED",
        tags: await getTagStore(source).read(source),
        corrections: [],
    });
});

test("processTrack still reports a tagged track whose tags cannot be read back", async (context) => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Artist - Title.mp3");
    await fs.writeFile(source, "audio bytes");
    globalThis.fetch = async (input) =>
        new URL(input.toString()).hostname === "itunes.apple.com"
            ? Response.json({
                  results: [
                      {
                          trackName: "Title",
                          artistName: "Artist",
                          primaryGenreName: "Rock",
                      },
                  ],
              })
            : Response.json({ results: { trackmatches: { track: [] } } });
    const readTags = Id3TagStore.prototype.read;
    let reads = 0;
    context.mock.method(
        Id3TagStore.prototype,
        "read",
        function (this: Id3TagStore, file: string) {
            reads += 1;
            return reads === 1
                ? readTags.call(this, file)
                : Promise.reject(new Error("unreadable"));
        }
    );

    const logger = createRecordingLogger();
    const result = await processTrack(source, {
        sourceRoot: directory,
        logger,
        metadataChain: createTestChain(),
    });

    assert.deepEqual(result, {
        status: "TAGGED",
        tags: null,
        corrections: [],
    });
    assert.deepEqual(logger.errors, [
        "Could not read the written tags: unreadable",
    ]);
});

function createChainFindingTitle(title: string, searches: TrackSearch[]) {
    return new MetadataChain(
        [
            {
                name: "Fake",
                findMetadata: async (search) => {
                    searches.push(search);
                    return search.title === title
                        ? {
                              info: {
                                  title,
                                  artist: "Alfa Rococo",
                                  album: "Lever l'ancre",
                                  year: "2007",
                              },
                              extras: {},
                              coverData: null,
                          }
                        : null;
                },
            },
        ],
        [],
        createProviderServices()
    );
}

test("processTrack searches again from the file name and replaces a suspect title", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Alfa Rococo - Lever l'ancre.mp3");
    await fs.writeFile(source, "audio bytes");
    NodeID3.write(
        { title: "Alfa Rococo - Lever L'ancre", album: "Tagged album" },
        source
    );
    const searches: TrackSearch[] = [];

    const { status } = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createChainFindingTitle("Lever l'ancre", searches),
    });

    assert.equal(status, "TAGGED");
    assert.deepEqual(
        searches.map(({ title, artist }) => ({ title, artist })),
        [
            { title: "Alfa Rococo - Lever L'ancre", artist: "Alfa Rococo" },
            { title: "Lever l'ancre", artist: "Alfa Rococo" },
        ]
    );
    const tags = await NodeID3.Promise.read(source);
    assert.deepEqual(
        [tags.title, tags.artist, tags.album, tags.year],
        ["Lever l'ancre", "Alfa Rococo", "Tagged album", "2007"]
    );
    assert.ok(
        output.logs.some((line) =>
            line.startsWith(
                `  search file name "Lever l'ancre" · Alfa Rococo: `
            )
        )
    );
});

test("processTrack does not search again when the tags look right", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "01 - Intro.mp3");
    await fs.writeFile(source, "audio bytes");
    NodeID3.write({ title: "Real Title", artist: "Band" }, source);
    const searches: TrackSearch[] = [];

    const { status } = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createChainFindingTitle("Intro", searches),
    });

    assert.equal(status, "SKIPPED");
    assert.equal(searches.length, 1);
});

test("processTrack reports a track found by neither search once", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Band - Missing.mp3");
    await fs.writeFile(source, "audio bytes");
    NodeID3.write({ title: "Band - Missing (tagged)" }, source);
    const searches: TrackSearch[] = [];

    const { status } = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createChainFindingTitle("Lever l'ancre", searches),
    });

    assert.equal(status, "SKIPPED");
    assert.equal(searches.length, 2);
    assert.equal(
        output.logs.filter((line) => line === "  skip   not found").length,
        1
    );
});

test("processTrack searches once when the file name gives the same search", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Alfa Rococo - Missing.mp3");
    await fs.writeFile(source, "audio bytes");
    NodeID3.write({ title: "missing" }, source);
    const searches: TrackSearch[] = [];

    const { status } = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: createChainFindingTitle("Lever l'ancre", searches),
    });

    assert.equal(status, "SKIPPED");
    assert.equal(searches.length, 1);
});

function createFakeCorrector(canonical: CanonicalTrack | null) {
    const searches: TrackSearch[] = [];
    const corrector = new TrackCorrector(
        [
            {
                name: "Fake",
                findCanonical: async (search) => {
                    searches.push(search);
                    return canonical;
                },
            },
        ],
        { name: "Witness", findCanonical: async () => canonical },
        createProviderServices().lookups
    );
    return { corrector, searches };
}

const dancingQueen: CanonicalTrack = {
    title: "Dancing Queen",
    artist: "ABBA",
    firstReleaseYear: "1976",
    albums: [],
    artistAlbums: [],
};

async function createCompilationTrack(
    extras: TrackExtras = { genre: "Pop" }
): Promise<string> {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "track.mp3");
    await fs.writeFile(source, "audio bytes");
    await getTagStore(source).write(source, {
        info: {
            title: "dancing queen",
            artist: "Abba",
            album: "Gold",
            year: "2002",
        },
        extras,
        coverData: Buffer.from("cover"),
    });
    return source;
}

function createNoLookupChain(): MetadataChain {
    return new MetadataChain(
        [
            {
                name: "Unexpected",
                findMetadata: async () => {
                    throw new Error("no lookup expected");
                },
            },
        ],
        [],
        createProviderServices()
    );
}

test("processTrack corrects a properly tagged file in fix mode", async () => {
    const source = await createCompilationTrack();
    const { corrector, searches } = createFakeCorrector(dancingQueen);
    const logger = createRecordingLogger();

    const result = await processTrack(source, {
        sourceRoot: path.dirname(source),
        logger,
        metadataChain: createNoLookupChain(),
        corrector,
    });

    assert.equal(result.status, "TAGGED");
    assert.deepEqual(result.tags?.info, {
        title: "Dancing Queen",
        artist: "ABBA",
        album: "Gold",
        year: "1976",
    });
    assert.equal(result.tags?.extras.genre, "Pop");
    assert.deepEqual(result.corrections, [
        { field: "title", from: "dancing queen", to: "Dancing Queen" },
        { field: "artist", from: "Abba", to: "ABBA" },
        { field: "year", from: "2002", to: "1976" },
    ]);
    assert.deepEqual(searches, [
        { title: "dancing queen", artist: "Abba", album: "" },
    ]);
    assert.ok(
        logger.infos.includes(
            '  fix    title: "dancing queen" → "Dancing Queen" · artist: "Abba" → "ABBA" · year: "2002" → "1976"'
        )
    );
});

test("processTrack skips a properly tagged file with nothing to correct", async () => {
    const source = await createCompilationTrack();
    const { corrector } = createFakeCorrector(null);

    const result = await processTrack(source, {
        sourceRoot: path.dirname(source),
        logger: consoleLogger,
        metadataChain: createNoLookupChain(),
        corrector,
    });

    assert.equal(result.status, "SKIPPED");
    assert.deepEqual(result.corrections, []);
    assert.ok(output.logs.includes("  skip   already tagged"));
});

test("processTrack searches with the corrected tags and fills the gaps", async () => {
    const source = await createCompilationTrack({});
    const { corrector } = createFakeCorrector(dancingQueen);
    const searches: TrackSearch[] = [];
    const genreChain = new MetadataChain(
        [
            {
                name: "Fake",
                findMetadata: async (search) => {
                    searches.push(search);
                    return {
                        info: { ...emptyInfo, title: "Dancing Queen" },
                        extras: { genre: "Disco" },
                        coverData: null,
                    };
                },
            },
        ],
        [],
        createProviderServices()
    );

    const result = await processTrack(source, {
        sourceRoot: path.dirname(source),
        logger: consoleLogger,
        metadataChain: genreChain,
        corrector,
    });

    assert.equal(result.status, "TAGGED");
    assert.equal(searches[0].title, "Dancing Queen");
    assert.equal(result.tags?.info.year, "1976");
    assert.equal(result.tags?.extras.genre, "Disco");
});

test("processTrack writes the corrections when the services find nothing else", async () => {
    const source = await createCompilationTrack({});
    const { corrector } = createFakeCorrector(dancingQueen);
    const nothingChain = new MetadataChain(
        [{ name: "Fake", findMetadata: async () => null }],
        [],
        createProviderServices()
    );

    const result = await processTrack(source, {
        sourceRoot: path.dirname(source),
        logger: consoleLogger,
        metadataChain: nothingChain,
        corrector,
    });

    assert.equal(result.status, "TAGGED");
    assert.equal(result.tags?.info.title, "Dancing Queen");
    assert.equal(output.logs.includes("  skip   not found"), false);
});

test("processTrack corrects nothing outside fix mode", async () => {
    const source = await createCompilationTrack();

    const result = await processTrack(source, {
        sourceRoot: path.dirname(source),
        logger: consoleLogger,
        metadataChain: createNoLookupChain(),
    });

    assert.equal(result.status, "SKIPPED");
    assert.deepEqual(result.corrections, []);
});

test("processTrack keeps multi-value fields of a FLAC it only corrects", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "track.flac");
    await fs.copyFile(
        path.join(process.cwd(), "tests/fixtures/silent.flac"),
        source
    );
    const file = TagLibFile.createFromPath(source);
    try {
        file.tag.title = "dancing queen";
        file.tag.performers = ["ABBA", "Guest"];
        file.tag.genres = ["Pop", "Disco"];
        file.tag.albumArtists = ["ABBA", "Various"];
        file.save();
    } finally {
        file.dispose();
    }
    const { corrector } = createFakeCorrector({
        ...dancingQueen,
        firstReleaseYear: "",
        albums: [],
        artistAlbums: [],
    });
    const nothingChain = new MetadataChain(
        [{ name: "Fake", findMetadata: async () => null }],
        [],
        createProviderServices()
    );

    const result = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: nothingChain,
        corrector,
    });

    assert.equal(result.status, "TAGGED");
    const written = TagLibFile.createFromPath(source);
    try {
        assert.equal(written.tag.title, "Dancing Queen");
        assert.deepEqual(written.tag.performers, ["ABBA", "Guest"]);
        assert.deepEqual(written.tag.genres, ["Pop", "Disco"]);
        assert.deepEqual(written.tag.albumArtists, ["ABBA", "Various"]);
    } finally {
        written.dispose();
    }
});

test("processTrack writes the corrections when the services add nothing new", async () => {
    const source = await createCompilationTrack({});
    const { corrector } = createFakeCorrector(dancingQueen);
    const sameChain = new MetadataChain(
        [
            {
                name: "Fake",
                findMetadata: async () => ({
                    info: { ...emptyInfo, title: "Dancing Queen" },
                    extras: {},
                    coverData: null,
                }),
            },
        ],
        [],
        createProviderServices()
    );

    const result = await processTrack(source, {
        sourceRoot: path.dirname(source),
        logger: consoleLogger,
        metadataChain: sameChain,
        corrector,
    });

    assert.equal(result.status, "TAGGED");
    assert.equal(result.tags?.info.year, "1976");
});

test("processTrack writes the corrections when the match has no title or artist", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "track.mp3");
    await fs.writeFile(source, "audio bytes");
    const { corrector } = createFakeCorrector(dancingQueen);
    const untitledChain = new MetadataChain(
        [
            {
                name: "Fake",
                findMetadata: async () => ({
                    info: { ...emptyInfo, album: "Album only" },
                    extras: {},
                    coverData: null,
                }),
            },
        ],
        [],
        createProviderServices()
    );

    const result = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: untitledChain,
        corrector,
    });

    assert.equal(result.status, "TAGGED");
    assert.equal(result.tags?.info.year, "1976");
    assert.deepEqual(
        result.corrections.map(({ field }) => field),
        ["year"]
    );
});

test("processTrack replaces a wrong artist and title that two services confirm", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "track.mp3");
    await fs.writeFile(source, "audio bytes");
    NodeID3.write(
        {
            title: "Eric Clapton And The Powerhouse - STEPPING OUT",
            artist: "Various Artists",
            album: "Blues",
            year: "1999",
        },
        source
    );
    const steppingOut = {
        title: "Stepping Out",
        artist: "Eric Clapton & The Powerhouse",
        firstReleaseYear: "1966",
        albums: [],
        artistAlbums: [],
    };
    const findSplitTitle = async ({ artist }: TrackSearch) =>
        artist === "Eric Clapton And The Powerhouse" ? steppingOut : null;
    const corrector = new TrackCorrector(
        [{ name: "Fake", findCanonical: findSplitTitle }],
        { name: "Witness", findCanonical: findSplitTitle },
        createProviderServices().lookups
    );
    const nothingChain = new MetadataChain(
        [{ name: "Fake", findMetadata: async () => null }],
        [],
        createProviderServices()
    );

    const result = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: nothingChain,
        corrector,
    });

    assert.equal(result.status, "TAGGED");
    assert.deepEqual(result.tags?.info, {
        title: "Stepping Out",
        artist: "Eric Clapton & The Powerhouse",
        album: "Blues",
        year: "1966",
    });
});

test("processTrack replaces a wrong album and the cover and numbers that came with it", async () => {
    const directory = await createTemporaryDirectory();
    const albumDirectory = path.join(directory, "Band", "Real Album");
    await fs.mkdir(albumDirectory, { recursive: true });
    const source = path.join(albumDirectory, "track.mp3");
    await fs.writeFile(source, "audio bytes");
    await getTagStore(source).write(source, {
        info: {
            title: "Madison",
            artist: "Band",
            album: "The Half of It: A Memoir",
            year: "2001",
        },
        extras: { genre: "Rock", trackNumber: 7 },
        coverData: Buffer.from("old cover"),
    });
    const corrector = new TrackCorrector(
        [
            {
                name: "Fake",
                findCanonical: async () => ({
                    title: "Madison",
                    artist: "Band",
                    firstReleaseYear: "",
                    albums: ["Real Album"],
                    artistAlbums: ["Real Album"],
                }),
            },
        ],
        { name: "Witness", findCanonical: async () => null },
        createProviderServices().lookups
    );
    const searches: TrackSearch[] = [];
    const releaseChain = new MetadataChain(
        [
            {
                name: "Fake",
                findMetadata: async (search) => {
                    searches.push(search);
                    return {
                        info: {
                            ...emptyInfo,
                            title: "Madison",
                            artist: "Band",
                        },
                        extras: { trackNumber: 2 },
                        coverData: Buffer.from("new cover"),
                    };
                },
            },
        ],
        [],
        createProviderServices()
    );

    const result = await processTrack(source, {
        sourceRoot: directory,
        logger: consoleLogger,
        metadataChain: releaseChain,
        corrector,
    });

    assert.equal(result.status, "TAGGED");
    assert.equal(searches[0].album, "Real Album");
    assert.equal(result.tags?.info.album, "Real Album");
    assert.equal(result.tags?.extras.trackNumber, 2);
    assert.equal(result.tags?.extras.genre, "Rock");
    const tags = await NodeID3.Promise.read(source);
    assert.deepEqual(
        typeof tags.image === "object" && tags.image.imageBuffer,
        Buffer.from("new cover")
    );
});

async function createFullyTaggedTrack(): Promise<string> {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "tagged.mp3");
    await fs.writeFile(source, "audio bytes");
    await getTagStore(source).write(source, {
        info: {
            title: "Old Title",
            artist: "Old Artist",
            album: "Old Album",
            year: "1990",
        },
        extras: { genre: "Old Genre", trackNumber: 1, discNumber: 2 },
        coverData: Buffer.from("old cover"),
    });
    return source;
}

type ProviderCall = { search: TrackSearch; needs: ProviderNeeds };

function createRecordingChain(
    found: TrackMetadata | null,
    calls: ProviderCall[] = [],
    fallbackCover: Buffer | null = null
): MetadataChain {
    return new MetadataChain(
        [
            {
                name: "Fake",
                findMetadata: async (search, needs) => {
                    calls.push({ search, needs });
                    return found;
                },
            },
        ],
        [{ name: "FakeCover", findCover: async () => fallbackCover }],
        createProviderServices()
    );
}

const newMetadata: TrackMetadata = {
    info: {
        title: "New Title",
        artist: "New Artist",
        album: "New Album",
        year: "2001",
    },
    extras: { genre: "New Genre", trackNumber: 5 },
    coverData: Buffer.from("new cover"),
};

function overwriteTrack(
    source: string,
    metadataChain: MetadataChain,
    corrector?: TrackCorrector
) {
    return processTrack(source, {
        sourceRoot: path.dirname(source),
        logger: consoleLogger,
        metadataChain,
        corrector,
        overwriteTags: true,
    });
}

test("processTrack overwrites existing tags with what the services find", async () => {
    const source = await createFullyTaggedTrack();
    const calls: ProviderCall[] = [];

    const result = await overwriteTrack(
        source,
        createRecordingChain(newMetadata, calls)
    );

    assert.equal(result.status, "TAGGED");
    assert.deepEqual(calls, [
        {
            search: {
                title: "Old Title",
                artist: "Old Artist",
                album: "Old Album",
            },
            needs: { cover: true, details: true },
        },
    ]);
    assert.deepEqual(result.tags?.info, newMetadata.info);
    assert.deepEqual(result.tags?.extras, newMetadata.extras);
    assert.deepEqual(
        await getTagStore(source).readCover(source),
        Buffer.from("new cover")
    );
});

test("processTrack keeps the existing tags when overwriting finds nothing", async () => {
    const source = await createFullyTaggedTrack();
    const before = await fs.readFile(source);

    const result = await overwriteTrack(source, createRecordingChain(null));

    assert.equal(result.status, "SKIPPED");
    assert.deepEqual(await fs.readFile(source), before);
    assert.ok(output.logs.includes("  skip   not found"));
});

test("processTrack leaves a file unchanged when overwriting finds the same tags", async () => {
    const source = await createFullyTaggedTrack();
    const before = await fs.readFile(source);
    const same = await getTagStore(source).read(source);
    const found = {
        info: same.info,
        extras: same.extras,
        coverData: Buffer.from("old cover"),
    };

    const result = await overwriteTrack(source, createRecordingChain(found));

    assert.equal(result.status, "SKIPPED");
    assert.deepEqual(await fs.readFile(source), before);
    assert.ok(output.logs.includes("  skip   nothing new"));
});

test("processTrack keeps the existing cover over a fallback cover when overwriting", async () => {
    const source = await createFullyTaggedTrack();
    const withoutCover = { ...newMetadata, coverData: null };
    const chain = createRecordingChain(
        withoutCover,
        [],
        Buffer.from("fallback")
    );

    await overwriteTrack(source, chain);

    assert.deepEqual(
        await getTagStore(source).readCover(source),
        Buffer.from("old cover")
    );
    assert.ok(
        output.logs.includes(
            '  write  title "New Title" · artist "New Artist" · album "New Album" · year "2001" · genre "New Genre" · track 5 · cleared disc'
        )
    );
});

test("processTrack keeps fix-mode corrections over what overwriting finds", async () => {
    const source = await createCompilationTrack();
    const { corrector } = createFakeCorrector(dancingQueen);
    const remaster = {
        ...newMetadata,
        info: { ...newMetadata.info, title: "Dancing Queen", year: "2011" },
    };

    const result = await overwriteTrack(
        source,
        createRecordingChain(remaster),
        corrector
    );

    assert.equal(result.status, "TAGGED");
    assert.deepEqual(result.tags?.info, {
        title: "Dancing Queen",
        artist: "ABBA",
        album: "New Album",
        year: "1976",
    });
});

test("processTrack writes the corrections when overwriting finds nothing", async () => {
    const source = await createCompilationTrack();
    const { corrector } = createFakeCorrector(dancingQueen);

    const result = await overwriteTrack(
        source,
        createRecordingChain(null),
        corrector
    );

    assert.equal(result.status, "TAGGED");
    assert.equal(result.tags?.info.year, "1976");
});

test("processTrack counts the kept tags as found when overwriting", async () => {
    const source = await createFullyTaggedTrack();
    const titleOnly = {
        info: { ...emptyInfo, title: "New Title", artist: "Old Artist" },
        extras: {},
        coverData: null,
    };

    await overwriteTrack(source, createRecordingChain(titleOnly));

    assert.ok(output.logs.includes('  write  title "New Title"'));
});
