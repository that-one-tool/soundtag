import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { isStoredCover } from "../../src/processing/stored-cover.js";
import { getTagStore } from "../../src/tags/audio-tags.js";
import { emptyTags } from "../helpers/metadata-chain.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-stored-cover-test-"
);

async function createTrackWithCover(): Promise<string> {
    const source = path.join(await createTemporaryDirectory(), "track.mp3");
    await fs.writeFile(source, "audio bytes");
    await getTagStore(source).write(source, {
        info: emptyTags.info,
        extras: {},
        coverData: Buffer.from("old cover"),
    });
    return source;
}

test("isStoredCover tells whether the file already holds the cover", async () => {
    const source = await createTrackWithCover();
    const tags = { ...emptyTags, hasCover: true };

    assert.equal(
        await isStoredCover(source, tags, Buffer.from("old cover")),
        true
    );
    assert.equal(
        await isStoredCover(source, tags, Buffer.from("new cover")),
        false
    );
    assert.equal(await isStoredCover(source, tags, null), false);
});

test("isStoredCover reads nothing for a file without a cover", async () => {
    const missing = path.join(await createTemporaryDirectory(), "missing.mp3");

    assert.equal(
        await isStoredCover(missing, emptyTags, Buffer.from("cover")),
        false
    );
});
