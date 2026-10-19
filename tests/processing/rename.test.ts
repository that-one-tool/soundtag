import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { getTagStore } from "../../src/tags/audio-tags.js";
import { renameTrack } from "../../src/processing/rename.js";
import { captureConsole } from "../helpers/console.js";
import { emptyInfo } from "../helpers/metadata-chain.js";
import type { TrackMetadata } from "../../src/metadata/types.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const output = captureConsole();
const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-rename-test-"
);

const thunderstruck = { ...emptyInfo, artist: "AC/DC", title: "Thunderstruck" };

async function createTaggedMp3(
    directory: string,
    filename: string,
    metadata: TrackMetadata = { info: thunderstruck, coverData: null }
): Promise<string> {
    const source = path.join(directory, filename);
    await fs.writeFile(source, "audio bytes");
    await getTagStore(source).write(source, metadata);
    return source;
}

test("renameTrack renames a file to its artist and title", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "01 track.mp3");

    const renamed = await renameTrack(source, "TAGGED");

    const expected = path.join(directory, "AC_DC - Thunderstruck.mp3");
    assert.equal(renamed, expected);
    await fs.access(expected);
    assert.ok(output.logs.includes("Renamed to: AC_DC - Thunderstruck.mp3"));
});

test("renameTrack leaves a file that already has the format", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(
        directory,
        "ac_dc - thunderstruck.mp3"
    );

    assert.equal(await renameTrack(source, "TAGGED"), null);
    await fs.access(source);
    assert.deepEqual(output.logs, []);
});

test("renameTrack leaves a file without artist or title", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "untitled.mp3", {
        info: { ...emptyInfo, title: "Only Title" },
        coverData: null,
    });

    assert.equal(await renameTrack(source, "TAGGED"), null);
    await fs.access(source);
});

test("renameTrack warns and keeps the name when the target exists", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "copy.mp3");
    await fs.writeFile(path.join(directory, "AC_DC - Thunderstruck.mp3"), "x");

    assert.equal(await renameTrack(source, "TAGGED"), null);
    await fs.access(source);
    assert.ok(
        output.logs.includes(
            "Not renamed: AC_DC - Thunderstruck.mp3 already exists."
        )
    );
});

test("renameTrack reports errors without throwing", async () => {
    const directory = await createTemporaryDirectory();

    assert.equal(
        await renameTrack(path.join(directory, "missing.flac"), "TAGGED"),
        null
    );
    assert.match(output.errors[0] ?? "", /^Rename error: /);
});

test("renameTrack keeps the extension as it is", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "01.MP3");

    assert.equal(
        await renameTrack(source, "TAGGED"),
        path.join(directory, "AC_DC - Thunderstruck.MP3")
    );
});

test("renameTrack renames a skipped file only when it is fully tagged", async () => {
    const directory = await createTemporaryDirectory();
    const notFound = await createTaggedMp3(directory, "not-found.mp3");
    const complete = await createTaggedMp3(directory, "complete.mp3", {
        info: { ...emptyInfo, artist: "Artist", title: "Title", year: "2024" },
        coverData: Buffer.from("cover"),
    });

    assert.equal(await renameTrack(notFound, "SKIPPED"), null);
    assert.equal(
        await renameTrack(complete, "SKIPPED"),
        path.join(directory, "Artist - Title.mp3")
    );
});

test("renameTrack never renames a failed file", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "failed.mp3");

    assert.equal(await renameTrack(source, "FAILED"), null);
    await fs.access(source);
});

test("renameTrack does not read a failed file again", async () => {
    const directory = await createTemporaryDirectory();
    const broken = path.join(directory, "broken.flac");
    await fs.writeFile(broken, "not really flac");

    assert.equal(await renameTrack(broken, "FAILED"), null);
    assert.deepEqual(output.errors, []);
});

test(
    "renameTrack reports a failed rename and keeps the file",
    { skip: process.getuid?.() === 0 && "root ignores folder permissions" },
    async () => {
        const directory = await createTemporaryDirectory();
        const source = await createTaggedMp3(directory, "01.mp3");
        await fs.chmod(directory, 0o555);

        try {
            assert.equal(await renameTrack(source, "TAGGED"), null);
            assert.match(output.errors[0] ?? "", /^Rename error: /);
        } finally {
            await fs.chmod(directory, 0o755);
        }

        await fs.access(source);
    }
);
