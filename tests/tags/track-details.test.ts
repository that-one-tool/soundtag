import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import NodeID3 from "node-id3";
import { File as TagLibFile } from "node-taglib-sharp";
import { readTrackDetails } from "../../src/tags/track-details.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-track-details-test-"
);

async function copyFixture(name: string): Promise<string> {
    const copy = path.join(await createTemporaryDirectory(), name);
    await fs.copyFile(path.join("tests", "fixtures", name), copy);
    return copy;
}

function writePosition(source: string): void {
    const file = TagLibFile.createFromPath(source);
    file.tag.track = 3;
    file.tag.trackCount = 12;
    file.tag.disc = 1;
    file.tag.discCount = 2;
    file.tag.genres = ["Rock"];
    file.save();
    file.dispose();
}

test("readTrackDetails reads the position, genre and audio properties", async () => {
    const source = await copyFixture("silent.flac");
    writePosition(source);

    const details = await readTrackDetails(source);

    assert.deepEqual(details, {
        trackNumber: 3,
        trackCount: 12,
        discNumber: 1,
        discCount: 2,
        genre: "Rock",
        durationMilliseconds: 100,
        bitrateKbps: 1.28,
        sampleRateHz: 44100,
        channels: 2,
        sizeBytes: (await fs.stat(source)).size,
    });
});

test("readTrackDetails leaves untagged fields empty", async () => {
    const details = await readTrackDetails(await copyFixture("silent.ogg"));

    assert.equal(details.trackNumber, 0);
    assert.equal(details.genre, "");
    assert.equal(details.channels, 1);
});

// MPEG-1 Layer III, 128 kbps, 44.1 kHz, mono: 417-byte frames.
const MPEG_FRAME = Buffer.concat([
    Buffer.from([0xff, 0xfb, 0x90, 0xc4]),
    Buffer.alloc(413),
]);

async function writeMp3(audio: Buffer): Promise<string> {
    const source = path.join(await createTemporaryDirectory(), "song.mp3");
    await fs.writeFile(source, audio);
    NodeID3.write({ trackNumber: "3/12", genre: "Rock" }, source);
    return source;
}

test("readTrackDetails reads the audio properties of an MP3", async () => {
    const source = await writeMp3(Buffer.concat(Array(40).fill(MPEG_FRAME)));

    const details = await readTrackDetails(source);

    assert.equal(details.trackNumber, 3);
    assert.equal(details.trackCount, 12);
    assert.equal(details.genre, "Rock");
    assert.equal(details.bitrateKbps, 128);
    assert.equal(details.sampleRateHz, 44100);
    assert.equal(details.channels, 1);
    assert.ok(details.durationMilliseconds > 0);
});

test("readTrackDetails keeps the tags and size when the audio cannot be parsed", async () => {
    const source = await writeMp3(Buffer.from("audio bytes"));

    const details = await readTrackDetails(source);

    assert.equal(details.sizeBytes, (await fs.stat(source)).size);
    assert.equal(details.trackNumber, 3);
    assert.equal(details.genre, "Rock");
    assert.equal(details.durationMilliseconds, 0);
});

test("readTrackDetails leaves everything but the size empty for unparsable files", async () => {
    const source = path.join(await createTemporaryDirectory(), "fake.flac");
    await fs.writeFile(source, "not flac");

    const details = await readTrackDetails(source);

    assert.equal(details.sizeBytes, 8);
    assert.equal(details.genre, "");
});

test("readTrackDetails rejects missing files", async () => {
    const source = path.join(await createTemporaryDirectory(), "missing.flac");

    await assert.rejects(readTrackDetails(source));
});
