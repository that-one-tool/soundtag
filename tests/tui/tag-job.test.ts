import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { createTagJobRunner } from "../../src/tui/tag-job.js";
import { MetadataChain } from "../../src/metadata/metadata-chain.js";
import { getTagStore } from "../../src/tags/audio-tags.js";
import type { ProcessedTrack } from "../../src/processing/types.js";
import type { PathMove } from "../../src/shared/paths.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { assertNoReport } from "../helpers/no-report.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";
import { createProviderServices } from "../helpers/metadata-chain.js";
import { RENAMING_ON } from "../helpers/tui.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-tag-job-test-"
);

const foundChain = new MetadataChain(
    [
        {
            name: "Fake",
            findMetadata: async () => ({
                info: {
                    title: "Title",
                    artist: "Artist",
                    album: "Album",
                    year: "2024",
                },
                extras: {},
                coverData: Buffer.from("cover"),
            }),
        },
    ],
    [],
    createProviderServices({ logger: createRecordingLogger() })
);

async function createTrack(
    directory: string,
    filename: string
): Promise<string> {
    const source = path.join(directory, filename);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(source, "audio bytes");
    return source;
}

const RENAMING_OFF = { renameFiles: false };

function createRunner(overrides: { libraryRoot?: string } = {}) {
    const processed: ProcessedTrack[] = [];
    const moves: PathMove[] = [];
    const logger = createRecordingLogger();
    const runJob = createTagJobRunner({
        metadataChain: foundChain,
        logger,
        libraryRoot: path.parse(process.cwd()).root,
        onTrackProcessed: (result) => processed.push(result),
        onFolderRenamed: (move) => moves.push(move),
        ...overrides,
    });
    return { runJob, processed, moves, logger };
}

test("a file job tags the file without writing a report", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTrack(directory, "song.mp3");
    const { runJob, processed } = createRunner();

    const succeeded = await runJob(
        { kind: "file", path: source, settings: RENAMING_OFF },
        new AbortController().signal
    );

    assert.equal(succeeded, true);
    assert.equal((await getTagStore(source).read(source)).info.title, "Title");
    assert.deepEqual(processed, [
        { source, status: "TAGGED", destination: null },
    ]);
    await assertNoReport(directory);
});

test("a folder job tags subfolders when recursive", async () => {
    const directory = await createTemporaryDirectory();
    await createTrack(directory, "a.mp3");
    await createTrack(path.join(directory, "Disc 2"), "b.mp3");
    const { runJob, processed } = createRunner();

    await runJob(
        {
            kind: "folder",
            path: directory,
            recursive: true,
            settings: RENAMING_ON,
        },
        new AbortController().signal
    );

    assert.deepEqual(
        processed.map(({ destination }) => destination),
        [
            path.join(directory, "Artist - Title.mp3"),
            path.join(directory, "Disc 2", "Artist - Title.mp3"),
        ]
    );
});

test("a folder job skips subfolders when not recursive", async () => {
    const directory = await createTemporaryDirectory();
    await createTrack(directory, "a.mp3");
    await createTrack(path.join(directory, "Disc 2"), "b.mp3");
    const { runJob, processed } = createRunner();

    await runJob(
        {
            kind: "folder",
            path: directory,
            recursive: false,
            settings: RENAMING_OFF,
        },
        new AbortController().signal
    );

    assert.deepEqual(
        processed.map(({ source }) => path.basename(source)),
        ["a.mp3"]
    );
});

test("a job fails when a file fails", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTrack(directory, "broken.flac");
    const { runJob } = createRunner();

    assert.equal(
        await runJob(
            { kind: "file", path: source, settings: RENAMING_OFF },
            new AbortController().signal
        ),
        false
    );
});

test("a job fails and logs when the folder cannot be read", async () => {
    const directory = path.join(await createTemporaryDirectory(), "missing");
    const { runJob, logger } = createRunner();

    const succeeded = await runJob(
        {
            kind: "folder",
            path: directory,
            recursive: true,
            settings: RENAMING_OFF,
        },
        new AbortController().signal
    );

    assert.equal(succeeded, false);
    assert.match(logger.errors[0], /^Error: .*ENOENT/);
    assert.equal(logger.infos.at(-1), "Done!");
});

test("a stopped job logs Done!", async () => {
    const directory = await createTemporaryDirectory();
    await createTrack(directory, "a.mp3");
    const { runJob, logger } = createRunner();

    await runJob(
        {
            kind: "folder",
            path: directory,
            recursive: true,
            settings: RENAMING_OFF,
        },
        AbortSignal.abort()
    );

    assert.deepEqual(logger.infos.slice(-2), [
        "Stopped before processing the remaining files.",
        "Done!",
    ]);
});

test("a job announces its target", async () => {
    const directory = await createTemporaryDirectory();
    await createTrack(directory, "a.mp3");
    const { runJob, logger } = createRunner();

    await runJob(
        {
            kind: "folder",
            path: directory,
            recursive: true,
            settings: RENAMING_OFF,
        },
        new AbortController().signal
    );

    assert.equal(logger.infos[0], `Tagging 1 audio files in ${directory}`);
    assert.equal(logger.infos.at(-1), "Done!");
});

test("a job without audio files succeeds", async () => {
    const directory = await createTemporaryDirectory();
    const { runJob, logger } = createRunner();

    const succeeded = await runJob(
        {
            kind: "folder",
            path: directory,
            recursive: true,
            settings: RENAMING_OFF,
        },
        new AbortController().signal
    );

    assert.equal(succeeded, true);
    assert.deepEqual(logger.infos, [
        `No supported audio files found in ${directory}.`,
        "Done!",
    ]);
});

test("a file job succeeds when its whole folder is gone", async () => {
    const directory = path.join(await createTemporaryDirectory(), "renamed");
    const { runJob, logger } = createRunner();

    const succeeded = await runJob(
        {
            kind: "file",
            path: path.join(directory, "a.mp3"),
            settings: RENAMING_OFF,
        },
        new AbortController().signal
    );

    assert.equal(succeeded, true);
    assert.deepEqual(logger.errors, []);
});

test("a file job skips a file that no longer exists", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "renamed-meanwhile.mp3");
    const { runJob, processed, logger } = createRunner();

    const succeeded = await runJob(
        { kind: "file", path: source, settings: RENAMING_OFF },
        new AbortController().signal
    );

    assert.equal(succeeded, true);
    assert.deepEqual(processed, []);
    assert.ok(logger.infos.includes(`Skipped: ${source} no longer exists.`));
    assert.equal(logger.infos.at(-1), "Done!");
});

test("a folder job renames the album folder below the library root", async () => {
    const libraryRoot = await createTemporaryDirectory();
    const album = path.join(libraryRoot, "old");
    await createTrack(album, "a.mp3");
    await createTrack(album, "b.mp3");
    const { runJob, moves } = createRunner({ libraryRoot });

    await runJob(
        {
            kind: "folder",
            path: album,
            recursive: false,
            settings: RENAMING_ON,
        },
        new AbortController().signal
    );

    assert.deepEqual(moves, [
        {
            source: album,
            destination: path.join(libraryRoot, "Artist - Album"),
        },
    ]);
});

test("a folder job keeps file and folder names when renaming is off", async () => {
    const libraryRoot = await createTemporaryDirectory();
    const album = path.join(libraryRoot, "old");
    const source = await createTrack(album, "a.mp3");
    const { runJob, processed, moves } = createRunner({ libraryRoot });

    await runJob(
        {
            kind: "folder",
            path: album,
            recursive: false,
            settings: RENAMING_OFF,
        },
        new AbortController().signal
    );

    assert.deepEqual(processed, [
        { source, status: "TAGGED", destination: null },
    ]);
    assert.deepEqual(moves, []);
});
