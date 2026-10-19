import assert from "node:assert/strict";
import { test } from "node:test";
import {
    buildAlbumFolderName,
    getDiscLabel,
    getDiscNumber,
} from "../../src/library/album-folder-name.js";

const album = { artist: " Artist ", album: " Album " };

test("buildAlbumFolderName joins artist and album", () => {
    assert.equal(buildAlbumFolderName(album, null), "Artist - Album");
});

test("buildAlbumFolderName replaces characters that folder names cannot hold", () => {
    assert.equal(
        buildAlbumFolderName({ artist: "AC/DC", album: "Live: 1992" }, null),
        "AC_DC - Live_ 1992"
    );
});

test("buildAlbumFolderName adds the disc label", () => {
    assert.equal(buildAlbumFolderName(album, "CD2"), "Artist - Album - CD2");
});

test("buildAlbumFolderName does not repeat a disc the album already names", () => {
    for (const disc of ["CD1", "cd 1", "CD-1"]) {
        assert.equal(
            buildAlbumFolderName({ artist: "A", album: "Night CD1" }, disc),
            "A - Night CD1"
        );
    }
    assert.equal(
        buildAlbumFolderName({ artist: "A", album: "Mix CD10" }, "CD1"),
        "A - Mix CD10 - CD1"
    );
    assert.equal(
        buildAlbumFolderName({ artist: "A", album: "ABCD1" }, "CD1"),
        "A - ABCD1 - CD1"
    );
});

test("buildAlbumFolderName truncates long names to 200 bytes but keeps the disc", () => {
    const name = buildAlbumFolderName(
        { artist: "Artist", album: "é".repeat(300) },
        "CD1"
    );

    assert.ok(Buffer.byteLength(name) <= 200);
    assert.ok(name.startsWith("Artist - éé"));
    assert.ok(name.endsWith("é - CD1"));
});

test("getDiscLabel reads disc folder names", () => {
    for (const disc of ["CD1", "cd 02", "Disc 2", "disk3", "CD-1", "Disc_2"]) {
        assert.equal(getDiscLabel(` ${disc} `), disc);
    }
});

test("getDiscLabel reads the disc of a folder it already renamed", () => {
    assert.equal(getDiscLabel("Old - Name - CD 2"), "CD 2");
});

test("getDiscLabel reads a disc at the end of a longer name", () => {
    for (const name of [
        "Album CD2",
        "Album (CD2)",
        "Album [CD2]",
        "Album_CD2",
        "Album (Disc  2)",
    ]) {
        assert.match(getDiscLabel(name) ?? "", /^(CD2|Disc 2)$/);
    }
});

test("getDiscLabel ignores names that are not disc numbers", () => {
    for (const name of ["Live 2", "ACDC2", "Discography", "CD"]) {
        assert.equal(getDiscLabel(name), null);
    }
});

test("getDiscNumber reads the number of a disc label", () => {
    assert.equal(getDiscNumber("CD 01"), 1);
    assert.equal(getDiscNumber("Disc_12"), 12);
});
