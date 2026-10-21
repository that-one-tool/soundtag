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
    assert.ok(output.logs.includes("Already properly tagged. Skipping."));
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
    assert.ok(
        output.logs.includes(
            "Track not found on available metadata services. Leaving source unchanged."
        )
    );
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
    assert.ok(
        output.logs.includes(
            "Track title or artist is missing. Leaving source unchanged."
        )
    );
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
    assert.ok(
        output.logs.includes(
            'Searching: "Title" (artist: "Artist") (album: "Folder Album")'
        )
    );
    assert.ok(
        output.logs.includes(
            "Some metadata was unavailable (album, year, genre, track number, cover art); saving the fields that were found."
        )
    );
    assert.ok(output.logs.includes("Successfully tagged source file."));
    assert.ok(output.logs.includes("Reading existing tags..."));
    assert.ok(output.logs.includes("Writing tags..."));
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
    assert.ok(!output.logs.some((line) => line.includes("cover art")));
    assert.ok(output.logs.includes("Cover: kept"));
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
    assert.ok(
        output.logs.includes("No new metadata found. Leaving source unchanged.")
    );
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

    assert.deepEqual(result, { status: "TAGGED", tags: null });
    assert.deepEqual(logger.errors, [
        "Could not read the written tags: unreadable",
    ]);
});
