import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import {
    borrowFolderCover,
    FolderCovers,
    type CoverSharing,
} from "../../src/processing/folder-covers.js";
import type { Logger } from "../../src/shared/logger.js";
import type { TrackInfo } from "../../src/metadata/types.js";
import { getTagStore } from "../../src/tags/audio-tags.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-folder-covers-test-"
);

const albumInfo: TrackInfo = {
    title: "Song",
    artist: "Artist",
    album: "Album",
    year: "2024",
};

function createSharing(
    sourceRoot: string,
    logger: Logger = createRecordingLogger()
): CoverSharing {
    return { folderCovers: new FolderCovers(), sourceRoot, logger };
}

async function createTrack(
    file: string,
    info: TrackInfo,
    coverData: Buffer | null
): Promise<string> {
    await fs.writeFile(file, `audio ${file}`);
    await getTagStore(file).write(file, { info, extras: {}, coverData });
    return file;
}

test("FolderCovers finds the cover of a sibling from the same artist and album", async () => {
    const directory = await createTemporaryDirectory();
    const holder = await createTrack(
        path.join(directory, "holder.mp3"),
        albumInfo,
        Buffer.from("cover")
    );

    const shared = await new FolderCovers().find(
        path.join(directory, "target.mp3"),
        { ...albumInfo, artist: " artist ", album: "ALBUM" }
    );

    assert.deepEqual(shared, { holder, coverData: Buffer.from("cover") });
});

test("FolderCovers ignores siblings from another artist or album, or without a cover", async () => {
    const directory = await createTemporaryDirectory();
    await createTrack(
        path.join(directory, "other-album.mp3"),
        { ...albumInfo, album: "Other" },
        Buffer.from("cover")
    );
    await createTrack(
        path.join(directory, "other-artist.mp3"),
        { ...albumInfo, artist: "Other" },
        Buffer.from("cover")
    );
    await createTrack(path.join(directory, "no-cover.mp3"), albumInfo, null);
    await fs.writeFile(path.join(directory, "broken.flac"), "not really flac");

    const shared = await new FolderCovers().find(
        path.join(directory, "target.mp3"),
        albumInfo
    );

    assert.equal(shared, null);
});

test("FolderCovers needs both the artist and the album to match", async () => {
    const directory = await createTemporaryDirectory();
    const blankAlbum = { ...albumInfo, album: "" };
    await createTrack(
        path.join(directory, "holder.mp3"),
        blankAlbum,
        Buffer.from("cover")
    );

    const shared = await new FolderCovers().find(
        path.join(directory, "target.mp3"),
        blankAlbum
    );

    assert.equal(shared, null);
});

test("FolderCovers ignores tracks in subfolders", async () => {
    const directory = await createTemporaryDirectory();
    await fs.mkdir(path.join(directory, "Disc 2"));
    await createTrack(
        path.join(directory, "Disc 2", "holder.mp3"),
        albumInfo,
        Buffer.from("cover")
    );

    const shared = await new FolderCovers().find(
        path.join(directory, "target.mp3"),
        albumInfo
    );

    assert.equal(shared, null);
});

test("borrowFolderCover copies a sibling cover without touching other tags", async () => {
    const directory = await createTemporaryDirectory();
    const album = path.join(directory, "Album");
    await fs.mkdir(album);
    await createTrack(
        path.join(album, "holder.mp3"),
        albumInfo,
        Buffer.from("cover")
    );
    const target = await createTrack(
        path.join(album, "target.mp3"),
        { ...albumInfo, title: "Other Song" },
        null
    );
    const logger = createRecordingLogger();

    assert.equal(
        await borrowFolderCover(target, createSharing(directory, logger)),
        true
    );

    const store = getTagStore(target);
    assert.deepEqual(await store.readCover(target), Buffer.from("cover"));
    assert.deepEqual((await store.read(target)).info, {
        ...albumInfo,
        title: "Other Song",
    });
    assert.deepEqual(logger.infos, [
        `\nCover copied to ${path.join("Album", "target.mp3")} from ${path.join("Album", "holder.mp3")} (same artist and album).`,
    ]);
});

test("borrowFolderCover leaves a track that already has a cover", async () => {
    const directory = await createTemporaryDirectory();
    await createTrack(
        path.join(directory, "holder.mp3"),
        albumInfo,
        Buffer.from("cover")
    );
    const target = await createTrack(
        path.join(directory, "target.mp3"),
        albumInfo,
        Buffer.from("own cover")
    );

    assert.equal(
        await borrowFolderCover(target, createSharing(directory)),
        false
    );
    assert.deepEqual(
        await getTagStore(target).readCover(target),
        Buffer.from("own cover")
    );
});

test("borrowFolderCover returns false when no sibling shares the album", async () => {
    const directory = await createTemporaryDirectory();
    const target = await createTrack(
        path.join(directory, "target.mp3"),
        albumInfo,
        null
    );

    assert.equal(
        await borrowFolderCover(target, createSharing(directory)),
        false
    );
});

test("borrowFolderCover logs and returns false when the track cannot be read", async () => {
    const directory = await createTemporaryDirectory();
    const target = path.join(directory, "broken.flac");
    await fs.writeFile(target, "not really flac");
    const logger = createRecordingLogger();

    assert.equal(
        await borrowFolderCover(target, createSharing(directory, logger)),
        false
    );
    assert.equal(logger.errors.length, 1);
    assert.match(logger.errors[0], /^Cover sharing error: /);
});

test("FolderCovers scans each folder once", async () => {
    const directory = await createTemporaryDirectory();
    const folderCovers = new FolderCovers();
    const target = path.join(directory, "target.mp3");
    assert.equal(await folderCovers.find(target, albumInfo), null);
    await createTrack(
        path.join(directory, "holder.mp3"),
        albumInfo,
        Buffer.from("cover")
    );

    assert.equal(await folderCovers.find(target, albumInfo), null);
});

test("FolderCovers keeps the first holder of an album", async () => {
    const directory = await createTemporaryDirectory();
    const first = await createTrack(
        path.join(directory, "a.mp3"),
        albumInfo,
        Buffer.from("first")
    );
    await createTrack(
        path.join(directory, "b.mp3"),
        albumInfo,
        Buffer.from("second")
    );

    const shared = await new FolderCovers().find(
        path.join(directory, "target.mp3"),
        albumInfo
    );

    assert.deepEqual(shared, {
        holder: first,
        coverData: Buffer.from("first"),
    });
});

test("FolderCovers reads each holder cover once", async () => {
    const directory = await createTemporaryDirectory();
    const holder = await createTrack(
        path.join(directory, "holder.mp3"),
        albumInfo,
        Buffer.from("cover")
    );
    const folderCovers = new FolderCovers();
    const target = path.join(directory, "target.mp3");
    await folderCovers.find(target, albumInfo);
    await getTagStore(holder).write(holder, {
        info: albumInfo,
        extras: {},
        coverData: Buffer.from("changed"),
    });

    assert.deepEqual(await folderCovers.find(target, albumInfo), {
        holder,
        coverData: Buffer.from("cover"),
    });
});

test("FolderCovers scans a folder again after a failed scan", async () => {
    const directory = await createTemporaryDirectory();
    const album = path.join(directory, "Album");
    const target = path.join(album, "target.mp3");
    const folderCovers = new FolderCovers();
    await assert.rejects(folderCovers.find(target, albumInfo));
    await fs.mkdir(album);
    const holder = await createTrack(
        path.join(album, "holder.mp3"),
        albumInfo,
        Buffer.from("cover")
    );

    assert.deepEqual(await folderCovers.find(target, albumInfo), {
        holder,
        coverData: Buffer.from("cover"),
    });
});
