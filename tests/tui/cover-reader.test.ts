import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import {
    COVER_SIZE,
    createCoverCache,
    createCoverReader,
} from "../../src/tui/cover-reader.js";
import { getTagStore } from "../../src/tags/audio-tags.js";
import type { BrowserEntry } from "../../src/tui/types.js";
import { createSplitImage } from "../helpers/images.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-cover-reader-test-"
);
const readCover = createCoverReader();

async function createSong(coverData: Buffer | null): Promise<BrowserEntry> {
    const directory = await createTemporaryDirectory();
    const song = path.join(directory, "song.mp3");
    await fs.writeFile(song, "audio bytes");
    await getTagStore(song).write(song, {
        info: { title: "Title", artist: "Artist", album: "", year: "" },
        extras: {},
        coverData,
    });
    return { name: "song.mp3", path: song, kind: "file" };
}

test("createCoverReader decodes the embedded cover to the cover size", async () => {
    const entry = await createSong(await createSplitImage());

    const lookup = await readCover(entry);

    assert.equal(lookup.kind, "found");
    const { art } = lookup as Extract<typeof lookup, { kind: "found" }>;
    assert.ok("pixels" in art);
    assert.equal(art.width, COVER_SIZE.width);
    assert.equal(art.height, COVER_SIZE.height);
    assert.equal(art.pixels.length, COVER_SIZE.width * COVER_SIZE.height * 3);
});

test("createCoverReader finds no cover without an embedded image", async () => {
    assert.deepEqual(await readCover(await createSong(null)), {
        kind: "missing",
    });
});

test("createCoverReader finds no cover when the image cannot be decoded", async () => {
    const entry = await createSong(await createSplitImage());
    const readWithBrokenDecoder = createCoverReader(async () => {
        throw new Error("Could not load the sharp module");
    });

    assert.deepEqual(await readWithBrokenDecoder(entry), { kind: "missing" });
});

test("createCoverReader finds no cover for folders", async () => {
    const directory = await createTemporaryDirectory();
    const folder: BrowserEntry = { name: "a", path: directory, kind: "folder" };

    assert.deepEqual(await readCover(folder), { kind: "missing" });
});

test("createCoverReader reports files it cannot read", async () => {
    const directory = await createTemporaryDirectory();
    const missing: BrowserEntry = {
        name: "gone.mp3",
        path: path.join(directory, "gone.mp3"),
        kind: "file",
    };

    assert.deepEqual(await readCover(missing), { kind: "unreadable" });
});

test("createCoverCache keeps no unreadable result", async () => {
    const entry = await createSong(await createSplitImage());
    const cache = createCoverCache("blocks");
    await fs.chmod(entry.path, 0o000);

    const lookup = await cache.read(entry);

    await fs.chmod(entry.path, 0o644);
    assert.equal(lookup.kind, "unreadable");
    assert.equal(cache.peek(entry), undefined);
});

test("createCoverCache reads no cover in the none mode", async () => {
    const entry = await createSong(await createSplitImage());
    const cache = createCoverCache("none");

    assert.deepEqual(await cache.read(entry), { kind: "missing" });
});

test("createCoverCache decodes a 512 pixel PNG in the kitty mode", async () => {
    const entry = await createSong(await createSplitImage());
    const cache = createCoverCache("kitty");

    const lookup = await cache.read(entry);

    const { art } = lookup as Extract<typeof lookup, { kind: "found" }>;
    assert.ok("png" in art);
    const metadata = await sharp(art.png).metadata();
    assert.deepEqual(
        [metadata.format, metadata.width, metadata.height],
        ["png", 512, 512]
    );
    assert.deepEqual([art.width, art.height], [48, 48]);
    assert.match(art.key, /^[0-9a-f]{40}$/);
});
