import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { findAlbumFolder, planTracks } from "../../src/library/album-plan.js";

const root = path.resolve("library");
const artistFolder = path.join(root, "Queen");
const albumFolder = path.join(artistFolder, "Queen - Jazz");

function inside(...parts: string[]): string {
    return path.join(...parts);
}

test("findAlbumFolder reads an album folder below its artist folder", () => {
    assert.deepEqual(
        findAlbumFolder(inside(albumFolder, "Queen - Bicycle.mp3")),
        { folder: albumFolder, artist: "Queen", album: "Jazz", disc: null }
    );
});

test("findAlbumFolder ignores letter case between the artist folders", () => {
    const folder = path.join(root, "queen", "QUEEN - Jazz (1978) [FLAC]");

    assert.deepEqual(findAlbumFolder(inside(folder, "song.flac")), {
        folder,
        artist: "QUEEN",
        album: "Jazz",
        disc: null,
    });
});

test("findAlbumFolder takes the disc from a disc subfolder", () => {
    assert.deepEqual(
        findAlbumFolder(inside(albumFolder, "CD2", "Queen - Mustapha.mp3")),
        { folder: albumFolder, artist: "Queen", album: "Jazz", disc: 2 }
    );
    assert.equal(
        findAlbumFolder(inside(albumFolder, "Disc 1", "a.mp3"))?.disc,
        1
    );
});

test("findAlbumFolder takes the disc from a disc suffix of the album folder", () => {
    const folder = path.join(artistFolder, "Queen - Live Killers - CD2");

    assert.deepEqual(findAlbumFolder(inside(folder, "a.mp3")), {
        folder,
        artist: "Queen",
        album: "Live Killers",
        disc: 2,
    });
});

test("findAlbumFolder finds no album outside the artist and album layout", () => {
    const outside = [
        inside(artistFolder, "Queen - Bicycle.mp3"),
        inside(root, "Queen - Jazz", "a.mp3"),
        inside(root, "Bowie", "Queen - Jazz", "a.mp3"),
        inside(artistFolder, "Jazz", "a.mp3"),
        inside(artistFolder, "Queen - Singles", "a.mp3"),
    ];

    for (const file of outside) {
        assert.equal(findAlbumFolder(file), null, file);
    }
});

function createLister(folders: Record<string, string[]>) {
    const listed: string[] = [];
    const listAlbumFiles = async (folder: string) => {
        listed.push(folder);
        return folders[folder] ?? [];
    };
    return { listAlbumFiles, listed };
}

test("planTracks makes one album of every file of an album folder", async () => {
    const tracks = ["a.mp3", "b.mp3", path.join("CD2", "c.mp3")].map((file) =>
        path.join(albumFolder, file)
    );
    const { listAlbumFiles, listed } = createLister({ [albumFolder]: tracks });

    const plan = await planTracks([tracks[1]], listAlbumFiles);

    assert.deepEqual(plan, {
        albums: [
            {
                folder: albumFolder,
                artist: "Queen",
                album: "Jazz",
                tracks: [
                    { path: tracks[0], disc: null },
                    { path: tracks[1], disc: null },
                    { path: tracks[2], disc: 2 },
                ],
            },
        ],
        singles: [],
    });
    assert.deepEqual(listed, [albumFolder]);
});

test("planTracks lists each album folder once and keeps singles apart", async () => {
    const single = path.join(artistFolder, "Queen - Bicycle.mp3");
    const tracks = ["a.mp3", "b.mp3"].map((file) =>
        path.join(albumFolder, file)
    );
    const { listAlbumFiles, listed } = createLister({ [albumFolder]: tracks });

    const plan = await planTracks(
        [tracks[0], single, tracks[1]],
        listAlbumFiles
    );

    assert.deepEqual(listed, [albumFolder]);
    assert.deepEqual(plan.singles, [single]);
    assert.deepEqual(
        plan.albums.map((album) => album.tracks.length),
        [2]
    );
});

test("planTracks makes one album per disc folder", async () => {
    const [first, second] = ["CD1", "CD2"].map((disc) =>
        path.join(artistFolder, `Queen - Live Killers - ${disc}`)
    );
    const { listAlbumFiles } = createLister({
        [first]: [path.join(first, "a.mp3")],
        [second]: [path.join(second, "b.mp3")],
    });

    const plan = await planTracks(
        [path.join(first, "a.mp3"), path.join(second, "b.mp3")],
        listAlbumFiles
    );

    assert.deepEqual(
        plan.albums.map(({ album, tracks }) => [album, tracks[0].disc]),
        [
            ["Live Killers", 1],
            ["Live Killers", 2],
        ]
    );
});

test("findAlbumFolder reads disc notes in any common form", () => {
    const discs: [string, number | null][] = [
        ["Queen - Jazz (Disc 2)", 2],
        ["Queen - Jazz - CD2 [FLAC]", 2],
        ["Queen - Jazz – CD2", 2],
        ["Queen - Jazz - CD0", null],
    ];

    for (const [name, disc] of discs) {
        const found = findAlbumFolder(inside(artistFolder, name, "a.mp3"));
        assert.deepEqual([found?.album, found?.disc], ["Jazz", disc], name);
    }
});

test("findAlbumFolder reads labelled disc folders and lets them win", () => {
    assert.equal(
        findAlbumFolder(inside(albumFolder, "CD1 - Bonus", "a.mp3"))?.disc,
        1
    );
    const suffixed = path.join(artistFolder, "Queen - Jazz - CD2");
    assert.equal(findAlbumFolder(inside(suffixed, "CD1", "a.mp3"))?.disc, 1);
});

test("findAlbumFolder takes no disc name for an album", () => {
    assert.equal(
        findAlbumFolder(inside(artistFolder, "Queen - CD2", "a.mp3")),
        null
    );
});

test("findAlbumFolder keeps the artist as the folder spells it", () => {
    const folder = path.join(root, "R.E.M", "R.E.M - Monster");

    assert.equal(findAlbumFolder(inside(folder, "a.mp3"))?.artist, "R.E.M");
});

test("findAlbumFolder resolves relative paths", () => {
    const relative = path.join("Queen", "Queen - Jazz", "a.mp3");

    assert.equal(
        findAlbumFolder(relative)?.folder,
        path.resolve("Queen", "Queen - Jazz")
    );
});

test("planTracks leaves out listed files of other folders and keeps the selected ones", async () => {
    const track = path.join(albumFolder, "a.mp3");
    const bonus = path.join(albumFolder, "Bonus", "b.mp3");
    const selected = path.join(albumFolder, "c.mp3");
    const { listAlbumFiles } = createLister({ [albumFolder]: [track, bonus] });

    const plan = await planTracks([selected, bonus], listAlbumFiles);

    assert.deepEqual(
        plan.albums[0].tracks.map((albumTrack) => albumTrack.path),
        [track, selected]
    );
    assert.deepEqual(plan.singles, [bonus]);
});
