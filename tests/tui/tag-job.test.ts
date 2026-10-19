import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { createTagJobRunner } from "../../src/tui/tag-job.js";
import { MetadataChain } from "../../src/metadata/metadata-chain.js";
import { getTagStore } from "../../src/tags/audio-tags.js";
import type { ProcessedTrack } from "../../src/processing/types.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

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
    undefined,
    createRecordingLogger()
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

function createRunner(
    overrides: { recursive?: boolean; renameFiles?: boolean } = {}
) {
    const processed: ProcessedTrack[] = [];
    const logger = createRecordingLogger();
    const runJob = createTagJobRunner({
        metadataChain: foundChain,
        logger,
        recursive: true,
        renameFiles: false,
        onTrackProcessed: (result) => processed.push(result),
        ...overrides,
    });
    return { runJob, processed, logger };
}

async function readReport(folder: string): Promise<unknown> {
    return JSON.parse(
        await fs.readFile(path.join(folder, "soundtag_output.json"), "utf8")
    );
}

test("a file job tags the file and writes the report in its folder", async () => {
    const directory = await createTemporaryDirectory();
    const source = await createTrack(directory, "song.mp3");
    const { runJob, processed } = createRunner();

    const succeeded = await runJob(
        { kind: "file", path: source },
        new AbortController().signal
    );

    assert.equal(succeeded, true);
    assert.equal((await getTagStore(source).read(source)).info.title, "Title");
    assert.deepEqual(processed, [
        { source, status: "TAGGED", destination: null },
    ]);
    assert.deepEqual(await readReport(directory), {
        files: { "song.mp3": "TAGGED" },
    });
});

test("a folder job tags subfolders when recursive", async () => {
    const directory = await createTemporaryDirectory();
    await createTrack(directory, "a.mp3");
    await createTrack(path.join(directory, "Disc 2"), "b.mp3");
    const { runJob, processed } = createRunner({ renameFiles: true });

    await runJob(
        { kind: "folder", path: directory },
        new AbortController().signal
    );

    assert.equal(processed.length, 2);
    assert.deepEqual(await readReport(directory), {
        files: { "a.mp3": "TAGGED", [path.join("Disc 2", "b.mp3")]: "TAGGED" },
        renamed: {
            "a.mp3": "Artist - Title.mp3",
            [path.join("Disc 2", "b.mp3")]: path.join(
                "Disc 2",
                "Artist - Title.mp3"
            ),
        },
    });
});

test("a folder job skips subfolders when not recursive", async () => {
    const directory = await createTemporaryDirectory();
    await createTrack(directory, "a.mp3");
    await createTrack(path.join(directory, "Disc 2"), "b.mp3");
    const { runJob, processed } = createRunner({ recursive: false });

    await runJob(
        { kind: "folder", path: directory },
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
            { kind: "file", path: source },
            new AbortController().signal
        ),
        false
    );
});

test("a job fails and logs when the folder cannot be read", async () => {
    const directory = path.join(await createTemporaryDirectory(), "missing");
    const { runJob, logger } = createRunner();

    const succeeded = await runJob(
        { kind: "folder", path: directory },
        new AbortController().signal
    );

    assert.equal(succeeded, false);
    assert.match(logger.errors[0], /^Error: .*ENOENT/);
});

test("a job fails when the report cannot be written", async () => {
    const directory = await createTemporaryDirectory();
    await createTrack(directory, "a.mp3");
    await fs.mkdir(path.join(directory, "soundtag_output.json"));
    const { runJob, logger } = createRunner();

    const succeeded = await runJob(
        { kind: "folder", path: directory },
        new AbortController().signal
    );

    assert.equal(succeeded, false);
    assert.match(
        logger.errors.at(-1) ?? "",
        /^Could not write processing report/
    );
});

test("a job announces its target", async () => {
    const directory = await createTemporaryDirectory();
    await createTrack(directory, "a.mp3");
    const { runJob, logger } = createRunner();

    await runJob(
        { kind: "folder", path: directory },
        new AbortController().signal
    );

    assert.equal(logger.infos[0], `Tagging 1 audio files in ${directory}`);
    assert.ok(logger.infos.includes("\nSaving report..."));
});

test("a job without audio files writes no report", async () => {
    const directory = await createTemporaryDirectory();
    const { runJob, logger } = createRunner();

    const succeeded = await runJob(
        { kind: "folder", path: directory },
        new AbortController().signal
    );

    assert.equal(succeeded, true);
    assert.deepEqual(logger.infos, [
        `No supported audio files found in ${directory}.`,
    ]);
    await assert.rejects(
        fs.access(path.join(directory, "soundtag_output.json"))
    );
});

test("a file job succeeds when its whole folder is gone", async () => {
    const directory = path.join(await createTemporaryDirectory(), "renamed");
    const { runJob, logger } = createRunner();

    const succeeded = await runJob(
        { kind: "file", path: path.join(directory, "a.mp3") },
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
        { kind: "file", path: source },
        new AbortController().signal
    );

    assert.equal(succeeded, true);
    assert.deepEqual(processed, []);
    assert.ok(logger.infos.includes(`Skipped: ${source} no longer exists.`));
});

test("a job merges its results into the folder report", async () => {
    const directory = await createTemporaryDirectory();
    await fs.writeFile(
        path.join(directory, "soundtag_output.json"),
        JSON.stringify({ files: { "old.mp3": "SKIPPED" } })
    );
    const source = await createTrack(directory, "song.mp3");
    const { runJob } = createRunner();

    await runJob({ kind: "file", path: source }, new AbortController().signal);

    assert.deepEqual(await readReport(directory), {
        files: { "old.mp3": "SKIPPED", "song.mp3": "TAGGED" },
    });
});
