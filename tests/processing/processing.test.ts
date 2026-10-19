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
import { createTestChain, emptyInfo } from "../helpers/metadata-chain.js";
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

        return new Response(cover, {
            headers: { "content-type": "image/jpeg" },
        });
    };

    const status = await processTrack(source, {
        sourceRoot: directory,
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

    const status = await processTrack(source, {
        sourceRoot: directory,
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
    assert.equal(tags.album, "API album");
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

    const status = await processTrack(source, {
        sourceRoot: directory,
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

    const status = await processTrack(source, {
        sourceRoot: directory,
        metadataChain: createTestChain(),
    });

    assert.equal(status, "FAILED");
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
        coverData: Buffer.from("cover"),
    });
    globalThis.fetch = async () => {
        throw new Error("no lookup expected");
    };

    assert.equal(
        await processTrack(source, {
            sourceRoot: directory,
            metadataChain: createTestChain(),
        }),
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
        await processTrack(source, {
            sourceRoot: directory,
            metadataChain: createTestChain(),
        }),
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
    globalThis.fetch = async (input) =>
        new URL(input.toString()).hostname === "itunes.apple.com"
            ? Response.json({ results: [{ collectionName: "Album only" }] })
            : Response.json({ results: { trackmatches: { track: [] } } });

    assert.equal(
        await processTrack(source, {
            sourceRoot: directory,
            metadataChain: createTestChain(),
        }),
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
        await processTrack(source, {
            sourceRoot: directory,
            metadataChain: createTestChain(),
        }),
        "TAGGED"
    );
    assert.ok(
        output.logs.includes(
            'Searching: "Title" (artist: "Artist") (album: "Folder Album")'
        )
    );
    assert.ok(
        output.logs.includes(
            "Some metadata was unavailable (album, year, cover art); saving the fields that were found."
        )
    );
    assert.ok(output.logs.includes("Successfully tagged source file."));
});
