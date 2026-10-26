import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { tagAlbumTrack } from "../../src/processing/album-tagging.js";
import type { AlbumData } from "../../src/metadata/types.js";
import { getTagStore } from "../../src/tags/audio-tags.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { createTestChain } from "../helpers/metadata-chain.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-album-tagging-test-"
);

const jazz: AlbumData = {
    album: "Jazz",
    artist: "Queen",
    year: "1978",
    genre: "Rock",
    cover: Buffer.from("album cover"),
    tracks: [
        {
            title: "Bicycle Race",
            trackNumber: 2,
            trackCount: 13,
            discNumber: 1,
            discCount: 1,
        },
    ],
    found: true,
};

async function createAlbumTrack(
    filename: string,
    tags?: Parameters<ReturnType<typeof getTagStore>["write"]>[1]
): Promise<string> {
    const folder = path.join(
        await createTemporaryDirectory(),
        "Queen",
        "Queen - Jazz"
    );
    const source = path.join(folder, filename);
    await fs.mkdir(folder, { recursive: true });
    await fs.writeFile(source, "audio bytes");
    if (tags) {
        await getTagStore(source).write(source, tags);
    }
    return source;
}

function tagWith(source: string, album: AlbumData, overwrite = false) {
    const logger = createRecordingLogger();
    const context = {
        sourceRoot: path.dirname(source),
        metadataChain: createTestChain(),
        logger,
        overwrite,
    };
    const track = { path: source, disc: null };
    return { status: tagAlbumTrack(track, async () => album, context), logger };
}

test("tagAlbumTrack writes the album and the matched tracklist entry", async () => {
    const source = await createAlbumTrack("Queen - bicycle race.mp3");

    assert.equal(await tagWith(source, jazz).status, "TAGGED");

    const stored = await getTagStore(source).read(source);
    assert.deepEqual(stored.info, {
        title: "Bicycle Race",
        artist: "Queen",
        album: "Jazz",
        year: "1978",
    });
    assert.deepEqual(stored.extras, {
        genre: "Rock",
        albumArtist: "Queen",
        trackNumber: 2,
        trackCount: 13,
        discNumber: 1,
        discCount: 1,
    });
    assert.deepEqual(await getTagStore(source).readCover(source), jazz.cover);
});

test("tagAlbumTrack keeps the file title and the folder disc without an entry", async () => {
    const source = await createAlbumTrack("Queen - Fun It.mp3");
    const track = { path: source, disc: 2 };
    const context = {
        sourceRoot: path.dirname(source),
        metadataChain: createTestChain(),
        logger: createRecordingLogger(),
    };

    assert.equal(
        await tagAlbumTrack(track, async () => jazz, context),
        "TAGGED"
    );

    const stored = await getTagStore(source).read(source);
    assert.equal(stored.info.title, "Fun It");
    assert.deepEqual(stored.extras, {
        genre: "Rock",
        albumArtist: "Queen",
        discNumber: 2,
    });
});

test("tagAlbumTrack only fills missing tags unless overwriting", async () => {
    const tags = {
        info: {
            title: "Bicycle Race",
            artist: "Queen + Guest",
            album: "Jazz (Remaster)",
            year: "2011",
        },
        extras: {},
        coverData: Buffer.from("old cover"),
    };
    const kept = await createAlbumTrack("Queen - Bicycle Race.mp3", tags);
    const replaced = await createAlbumTrack("Queen - Bicycle Race.mp3", tags);

    await tagWith(kept, jazz).status;
    await tagWith(replaced, jazz, true).status;

    const keptTags = await getTagStore(kept).read(kept);
    assert.equal(keptTags.info.album, "Jazz (Remaster)");
    assert.equal(keptTags.extras.trackNumber, 2);
    assert.deepEqual(await getTagStore(kept).readCover(kept), tags.coverData);
    const replacedTags = await getTagStore(replaced).read(replaced);
    assert.deepEqual(replacedTags.info, {
        title: "Bicycle Race",
        artist: "Queen",
        album: "Jazz",
        year: "1978",
    });
    assert.equal(replacedTags.extras.genre, "Rock");
    assert.deepEqual(
        await getTagStore(replaced).readCover(replaced),
        jazz.cover
    );
});

test("tagAlbumTrack skips a track that already has everything", async () => {
    const source = await createAlbumTrack("Queen - Bicycle Race.mp3");
    await tagWith(source, jazz).status;

    const { status, logger } = tagWith(source, jazz);

    assert.equal(await status, "SKIPPED");
    assert.ok(logger.infos.includes("  skip   already tagged"));
});

test("tagAlbumTrack fails an unreadable file", async () => {
    const source = await createAlbumTrack("broken.flac");

    const { status, logger } = tagWith(source, jazz);

    assert.equal(await status, "FAILED");
    assert.match(logger.errors[0], /^Processing error: /);
});

test("tagAlbumTrack keeps the stored numbers of a track missing from the tracklist", async () => {
    const source = await createAlbumTrack("Queen - Fun It.mp3", {
        info: { title: "Fun It", artist: "Queen", album: "", year: "" },
        extras: { trackNumber: 5, trackCount: 13 },
        coverData: null,
    });

    assert.equal(await tagWith(source, jazz, true).status, "TAGGED");

    const { extras } = await getTagStore(source).read(source);
    assert.equal(extras.trackNumber, 5);
    assert.equal(extras.trackCount, 13);
});
