import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { FolderNameCache } from "../../src/library/folder-names.js";
import type { TrackInfo } from "../../src/metadata/types.js";
import {
    findFolderAlbum,
    renameAlbumFolder,
    type AlbumFolderRenaming,
} from "../../src/processing/album-folders.js";
import { getTagStore } from "../../src/tags/audio-tags.js";
import type { StoredTags } from "../../src/tags/types.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { emptyInfo } from "../helpers/metadata-chain.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-album-folders-test-"
);

const albumInfo: TrackInfo = {
    ...emptyInfo,
    title: "Song",
    artist: "Artist",
    album: "Album",
};

type TestRenaming = AlbumFolderRenaming & {
    knownTags: Map<string, StoredTags>;
    logger: ReturnType<typeof createRecordingLogger>;
};

function createRenaming(libraryRoot: string): TestRenaming {
    return {
        libraryRoot,
        knownTags: new Map(),
        folderNames: new FolderNameCache([]),
        logger: createRecordingLogger(),
    };
}

async function createTrack(file: string, info = albumInfo): Promise<string> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "audio bytes");
    await getTagStore(file).write(file, { info, extras: {}, coverData: null });
    return file;
}

async function createProcessedTrack(
    file: string,
    renaming: TestRenaming,
    { info = albumInfo, extras = {} }: Partial<StoredTags> = {}
): Promise<void> {
    await createTrack(file, info);
    renaming.knownTags.set(file, { info, extras, hasCover: true });
}

async function createAlbumFolder(folder: string, renaming: TestRenaming) {
    await createProcessedTrack(path.join(folder, "1.mp3"), renaming);
    await createProcessedTrack(path.join(folder, "2.mp3"), renaming, {
        info: { ...albumInfo, title: "Other", artist: " ARTIST " },
    });
}

async function createLibrary() {
    const libraryRoot = await createTemporaryDirectory();
    const folder = path.join(libraryRoot, "old");
    const renaming = createRenaming(libraryRoot);
    await createAlbumFolder(folder, renaming);
    return { libraryRoot, folder, renaming };
}

test("findFolderAlbum describes a folder of one album", async () => {
    const { folder, renaming } = await createLibrary();
    await fs.writeFile(path.join(folder, "cover.jpg"), "image");
    await fs.mkdir(path.join(folder, "Scans"));

    assert.deepEqual(await findFolderAlbum(folder, renaming), {
        folder,
        artist: "Artist",
        album: "Album",
        key: "artist\u0000album",
        disc: null,
        discCount: 0,
    });
});

test("findFolderAlbum prefers the album artist over track artists", async () => {
    const libraryRoot = await createTemporaryDirectory();
    const folder = path.join(libraryRoot, "ost");
    const renaming = createRenaming(libraryRoot);
    for (const [name, artist] of [
        ["1.mp3", "Singer"],
        ["2.mp3", "Band"],
    ]) {
        await createProcessedTrack(path.join(folder, name), renaming, {
            info: { ...albumInfo, artist },
            extras: {
                albumArtist: "Composer\u0000",
                discNumber: 2,
                discCount: 3,
            },
        });
    }

    const album = await findFolderAlbum(folder, renaming);

    assert.equal(album?.artist, "Composer");
    assert.equal(album?.disc, 2);
    assert.equal(album?.discCount, 3);
});

test("findFolderAlbum falls back to the track artist without album artist", async () => {
    const { folder, renaming } = await createLibrary();
    const [first] = renaming.knownTags.values();
    first.extras = { albumArtist: " " };

    assert.equal((await findFolderAlbum(folder, renaming))?.artist, "Artist");
});

test("findFolderAlbum leaves the disc unknown when tracks disagree", async () => {
    const { folder, renaming } = await createLibrary();
    [...renaming.knownTags.values()].forEach((tags, index) => {
        tags.extras = { discNumber: index + 1 };
    });

    assert.equal((await findFolderAlbum(folder, renaming))?.disc, null);
});

const keptFolderCases: [
    string,
    (folder: string, renaming: TestRenaming) => Promise<unknown>,
][] = [
    [
        "a track from another album",
        (folder, renaming) =>
            createProcessedTrack(path.join(folder, "3.mp3"), renaming, {
                info: { ...albumInfo, album: "Other" },
            }),
    ],
    [
        "a track without an album",
        (folder, renaming) =>
            createProcessedTrack(path.join(folder, "3.mp3"), renaming, {
                info: { ...albumInfo, album: "" },
            }),
    ],
    [
        "a track not trusted in this batch",
        (folder) => createTrack(path.join(folder, "3.mp3")),
    ],
    [
        "a subfolder holding tracks",
        (folder) => createTrack(path.join(folder, "CD1", "deep", "1.mp3")),
    ],
    [
        "a single track",
        (folder, renaming) => {
            const removed = path.join(folder, "2.mp3");
            renaming.knownTags.delete(removed);
            return fs.rm(removed);
        },
    ],
];

for (const [description, changeFolder] of keptFolderCases) {
    test(`findFolderAlbum skips a folder with ${description}`, async () => {
        const { folder, renaming } = await createLibrary();
        await changeFolder(folder, renaming);

        assert.equal(await findFolderAlbum(folder, renaming), null);
    });
}

test("findFolderAlbum skips the library root and its parents", async () => {
    const { folder, renaming } = await createLibrary();

    for (const libraryRoot of [folder, path.join(folder, "inner")]) {
        const album = await findFolderAlbum(folder, {
            ...renaming,
            libraryRoot,
        });

        assert.equal(album, null);
    }
});

test("findFolderAlbum sees through symbolic links to the library root", async () => {
    const { folder, renaming } = await createLibrary();
    const link = path.join(await createTemporaryDirectory(), "link");
    await fs.symlink(folder, link);

    assert.equal(
        await findFolderAlbum(folder, { ...renaming, libraryRoot: link }),
        null
    );
});

test("findFolderAlbum logs an error when the folder cannot be read", async () => {
    const libraryRoot = await createTemporaryDirectory();
    const renaming = createRenaming(libraryRoot);

    const album = await findFolderAlbum(
        path.join(libraryRoot, "gone"),
        renaming
    );

    assert.equal(album, null);
    assert.equal(renaming.logger.errors.length, 1);
    assert.match(renaming.logger.errors[0], /^Folder rename error: /);
});

test("renameAlbumFolder moves the folder to its new name", async () => {
    const { libraryRoot, folder, renaming } = await createLibrary();

    const move = await renameAlbumFolder(
        { folder, name: "Artist - Album" },
        renaming
    );

    const destination = path.join(libraryRoot, "Artist - Album");
    assert.deepEqual(move, { source: folder, destination });
    await fs.access(path.join(destination, "1.mp3"));
    assert.deepEqual(renaming.logger.infos, [
        "\nFolder renamed: old → Artist - Album",
    ]);
});

test("renameAlbumFolder keeps a folder that already has the name", async () => {
    const { folder, renaming } = await createLibrary();

    assert.equal(
        await renameAlbumFolder({ folder, name: "OLD" }, renaming),
        null
    );
    assert.deepEqual(renaming.logger.infos, []);
});

test("renameAlbumFolder keeps a folder whose new name is taken", async () => {
    const { libraryRoot, folder, renaming } = await createLibrary();
    await fs.mkdir(path.join(libraryRoot, "ARTIST - ALBUM"));

    const move = await renameAlbumFolder(
        { folder, name: "Artist - Album" },
        renaming
    );

    assert.equal(move, null);
    await fs.access(folder);
    assert.deepEqual(renaming.logger.infos, [
        "\nFolder not renamed: Artist - Album already exists.",
    ]);
});

test("renameAlbumFolder logs an error when the folder cannot be moved", async () => {
    const libraryRoot = await createTemporaryDirectory();
    const renaming = createRenaming(libraryRoot);

    const move = await renameAlbumFolder(
        { folder: path.join(libraryRoot, "gone"), name: "New" },
        renaming
    );

    assert.equal(move, null);
    assert.match(renaming.logger.errors[0], /^Folder rename error: /);
});

test("findFolderAlbum counts a later disc as part of a multi-disc album", async () => {
    const { folder, renaming } = await createLibrary();
    for (const tags of renaming.knownTags.values()) {
        tags.extras = { discNumber: 3 };
    }

    const album = await findFolderAlbum(folder, renaming);

    assert.equal(album?.discCount, 3);
});
