import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { createTagJobRunner } from "../../src/tui/tag-job.js";
import { MetadataChain } from "../../src/metadata/metadata-chain.js";
import { getTagStore } from "../../src/tags/audio-tags.js";
import type { ProcessedTrack } from "../../src/processing/types.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { assertNoReport } from "../helpers/no-report.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";
import { createProviderServices } from "../helpers/metadata-chain.js";
import { DEFAULT_JOB_SETTINGS } from "../helpers/tui.js";

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

function createRunner() {
    const processed: ProcessedTrack[] = [];
    const logger = createRecordingLogger();
    const runJob = createTagJobRunner({
        metadataChain: foundChain,
        logger,
        onTrackProcessed: (result) => processed.push(result),
    });
    return { runJob, processed, logger };
}

test("a file job tags the file without writing a report", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTrack(directory, "song.mp3");
    const { runJob, processed } = createRunner();

    const succeeded = await runJob(
        { kind: "file", path: source, settings: DEFAULT_JOB_SETTINGS },
        new AbortController().signal
    );

    assert.equal(succeeded, true);
    assert.equal((await getTagStore(source).read(source)).info.title, "Title");
    assert.deepEqual(processed, [{ source, status: "TAGGED" }]);
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
            settings: DEFAULT_JOB_SETTINGS,
            path: directory,
            recursive: true,
        },
        new AbortController().signal
    );

    assert.deepEqual(
        processed.map(({ source }) => source),
        [path.join(directory, "a.mp3"), path.join(directory, "Disc 2", "b.mp3")]
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
            settings: DEFAULT_JOB_SETTINGS,
            path: directory,
            recursive: false,
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
            { kind: "file", path: source, settings: DEFAULT_JOB_SETTINGS },
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
            settings: DEFAULT_JOB_SETTINGS,
            path: directory,
            recursive: true,
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
            settings: DEFAULT_JOB_SETTINGS,
            path: directory,
            recursive: true,
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
            settings: DEFAULT_JOB_SETTINGS,
            path: directory,
            recursive: true,
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
            settings: DEFAULT_JOB_SETTINGS,
            path: directory,
            recursive: true,
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
            settings: DEFAULT_JOB_SETTINGS,
            path: path.join(directory, "a.mp3"),
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
        { kind: "file", path: source, settings: DEFAULT_JOB_SETTINGS },
        new AbortController().signal
    );

    assert.equal(succeeded, true);
    assert.deepEqual(processed, []);
    assert.ok(logger.infos.includes(`Skipped: ${source} no longer exists.`));
    assert.equal(logger.infos.at(-1), "Done!");
});

test("a job overwrites existing tags only when overwriting is on", async () => {
    const directory = await createTemporaryDirectory();
    const [overwritten, kept] = await Promise.all(
        ["overwritten.mp3", "kept.mp3"].map(async (filename) => {
            const source = await createTrack(directory, filename);
            await getTagStore(source).write(source, {
                info: {
                    title: "Old",
                    artist: "Artist",
                    album: "",
                    year: "1990",
                },
                extras: { genre: "Rock" },
                coverData: Buffer.from("old cover"),
            });
            return source;
        })
    );
    const { runJob } = createRunner();

    await runJob(
        { kind: "file", path: overwritten, settings: { overwrite: true } },
        new AbortController().signal
    );
    await runJob(
        { kind: "file", path: kept, settings: { overwrite: false } },
        new AbortController().signal
    );

    const store = getTagStore(overwritten);
    assert.equal((await store.read(overwritten)).info.title, "Title");
    assert.equal((await store.read(kept)).info.title, "Old");
});
