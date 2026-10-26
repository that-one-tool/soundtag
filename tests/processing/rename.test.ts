import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { getTagStore } from "../../src/tags/audio-tags.js";
import { renameTrack } from "../../src/processing/rename.js";
import { captureConsole } from "../helpers/console.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { consoleLogger } from "../../src/shared/logger.js";
import { emptyInfo } from "../helpers/metadata-chain.js";
import { FolderNameCache } from "../../src/library/folder-names.js";
import type { TrackStatus } from "../../src/processing/types.js";
import type { TrackMetadata } from "../../src/metadata/types.js";
import type { StoredTags } from "../../src/tags/types.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const output = captureConsole();
const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-rename-test-"
);

function readTagsOrNull(source: string): Promise<StoredTags | null> {
    return getTagStore(source)
        .read(source)
        .catch(() => null);
}

async function renameAlone(
    source: string,
    status: TrackStatus,
    tags?: StoredTags
) {
    const read = tags ?? (await readTagsOrNull(source));
    return renameTrack(
        { source, status, tags: read, songFound: true },
        { folderNames: new FolderNameCache([source]), logger: consoleLogger }
    );
}

function renameUnfound(source: string, tags: StoredTags) {
    return renameTrack(
        { source, status: "TAGGED", tags, songFound: false },
        { folderNames: new FolderNameCache([source]), logger: consoleLogger }
    );
}

const thunderstruck = { ...emptyInfo, artist: "AC/DC", title: "Thunderstruck" };

async function createTaggedMp3(
    directory: string,
    filename: string,
    metadata: TrackMetadata = {
        info: thunderstruck,
        extras: {},
        coverData: null,
    }
): Promise<string> {
    const source = path.join(directory, filename);
    await fs.writeFile(source, "audio bytes");
    await getTagStore(source).write(source, metadata);
    return source;
}

test("renameTrack renames a file to its artist and title", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "01 track.mp3");

    const renamed = await renameAlone(source, "TAGGED");

    const expected = path.join(directory, "AC_DC - Thunderstruck.mp3");
    assert.equal(renamed, expected);
    await fs.access(expected);
    assert.ok(output.logs.includes("  rename AC_DC - Thunderstruck.mp3"));
});

test("renameTrack leaves a file that already has the format", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(
        directory,
        "ac_dc - thunderstruck.mp3"
    );

    assert.equal(await renameAlone(source, "TAGGED"), null);
    await fs.access(source);
    assert.deepEqual(output.logs, []);
});

test("renameTrack leaves a file without artist or title", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "untitled.mp3", {
        info: { ...emptyInfo, title: "Only Title" },
        extras: {},
        coverData: null,
    });

    assert.equal(await renameAlone(source, "TAGGED"), null);
    await fs.access(source);
});

test("renameTrack warns and keeps the name when the target exists", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "copy.mp3");
    await fs.writeFile(path.join(directory, "AC_DC - Thunderstruck.mp3"), "x");

    assert.equal(await renameAlone(source, "TAGGED"), null);
    await fs.access(source);
    assert.ok(
        output.logs.includes(
            "  rename skipped: AC_DC - Thunderstruck.mp3 already exists"
        )
    );
});

test("renameTrack reports errors without throwing", async () => {
    const directory = await createTemporaryDirectory();

    assert.equal(
        await renameAlone(path.join(directory, "missing.flac"), "TAGGED", {
            info: thunderstruck,
            extras: {},
            hasCover: false,
        }),
        null
    );
    assert.match(output.errors[0] ?? "", /^Rename error: /);
});

test("renameTrack keeps the extension as it is", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "01.MP3");

    assert.equal(
        await renameAlone(source, "TAGGED"),
        path.join(directory, "AC_DC - Thunderstruck.MP3")
    );
});

test("renameTrack renames a skipped file only when it is fully tagged", async () => {
    const directory = await createTemporaryDirectory();
    const notFound = await createTaggedMp3(directory, "not-found.mp3");
    const complete = await createTaggedMp3(directory, "complete.mp3", {
        info: { ...emptyInfo, artist: "Artist", title: "Title", year: "2024" },
        extras: {},
        coverData: Buffer.from("cover"),
    });

    assert.equal(await renameAlone(notFound, "SKIPPED"), null);
    assert.equal(
        await renameAlone(complete, "SKIPPED"),
        path.join(directory, "Artist - Title.mp3")
    );
});

test("renameTrack never renames a failed file", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "failed.mp3");

    assert.equal(await renameAlone(source, "FAILED"), null);
    await fs.access(source);
});

test("renameTrack does not read a failed file again", async () => {
    const directory = await createTemporaryDirectory();
    const broken = path.join(directory, "broken.flac");
    await fs.writeFile(broken, "not really flac");

    assert.equal(await renameAlone(broken, "FAILED"), null);
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
            assert.equal(await renameAlone(source, "TAGGED"), null);
            assert.match(output.errors[0] ?? "", /^Rename error: /);
        } finally {
            await fs.chmod(directory, 0o755);
        }

        await fs.access(source);
    }
);

test("renameTrack logs to the injected logger", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "01 track.mp3");
    const logger = createRecordingLogger();

    await renameTrack(
        {
            source,
            status: "TAGGED",
            tags: await readTagsOrNull(source),
            songFound: true,
        },
        { folderNames: new FolderNameCache([source]), logger }
    );

    assert.deepEqual(logger.infos, ["  rename AC_DC - Thunderstruck.mp3"]);
    assert.deepEqual(output.logs, []);
});

test("renameTrack names the file from the given tags without reading it", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "01 track.mp3");

    const renamed = await renameAlone(source, "TAGGED", {
        info: { ...thunderstruck, title: "Back In Black" },
        extras: {},
        hasCover: false,
    });

    assert.equal(renamed, path.join(directory, "AC_DC - Back In Black.mp3"));
});

test("renameTrack trusts a tagged file no service found only once fully tagged", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTaggedMp3(directory, "01 track.mp3");
    const tags = await getTagStore(source).read(source);
    const fullyTagged = {
        ...tags,
        info: { ...tags.info, year: "1990" },
        extras: { genre: "Rock" },
        hasCover: true,
    };

    assert.equal(await renameUnfound(source, tags), null);
    assert.equal(
        await renameUnfound(source, fullyTagged),
        path.join(directory, "AC_DC - Thunderstruck.mp3")
    );
});
