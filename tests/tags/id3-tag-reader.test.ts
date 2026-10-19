import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import NodeID3 from "node-id3";
import { readId3TagBytes } from "../../src/tags/id3-tag-reader.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-id3-tag-reader-test-"
);
const AUDIO = Buffer.alloc(4096, 0xff);

async function writeFile(data: Buffer): Promise<string> {
    const source = path.join(await createTemporaryDirectory(), "track.mp3");
    await fs.writeFile(source, data);
    return source;
}

function buildHeader(flags: number, tagSize: number, version = 4): Buffer {
    const syncsafeSize = [21, 14, 7, 0].map(
        (shift) => (tagSize >> shift) & 0x7f
    );
    return Buffer.from([0x49, 0x44, 0x33, version, 0, flags, ...syncsafeSize]);
}

test("readId3TagBytes reads only the ID3 tag, not the audio", async () => {
    const source = await writeFile(AUDIO);
    NodeID3.write({ title: "Title" }, source);

    const tagBytes = await readId3TagBytes(source);

    assert.equal(tagBytes.length, (await fs.stat(source)).size - AUDIO.length);
    assert.equal(NodeID3.read(tagBytes).title, "Title");
});

test("readId3TagBytes includes the footer when the header flags one", async () => {
    const header = buildHeader(0x10, 200);
    const source = await writeFile(Buffer.concat([header, AUDIO]));

    assert.equal((await readId3TagBytes(source)).length, 10 + 200 + 10);
});

test("readId3TagBytes reads the whole file when it does not start with a tag", async () => {
    const source = await writeFile(AUDIO);

    assert.deepEqual(await readId3TagBytes(source), AUDIO);
});

test("readId3TagBytes reads the whole file when it is shorter than a header", async () => {
    const source = await writeFile(Buffer.from("ID3"));

    assert.deepEqual(await readId3TagBytes(source), Buffer.from("ID3"));
});

test("readId3TagBytes reads the whole file when the header is not valid ID3v2", async () => {
    for (const header of [
        buildHeader(0, 200, 5),
        Buffer.from([0x49, 0x44, 0x33, 4, 1, 0, 0, 0, 1, 0]),
        Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0x80, 0]),
    ]) {
        const data = Buffer.concat([header, AUDIO]);

        assert.deepEqual(await readId3TagBytes(await writeFile(data)), data);
    }
});

test("readId3TagBytes stops at the end of a file shorter than its tag", async () => {
    const data = Buffer.concat([buildHeader(0, 100_000), AUDIO]);

    assert.equal(
        (await readId3TagBytes(await writeFile(data))).length,
        data.length
    );
});
