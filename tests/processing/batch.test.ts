import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { getTagStore } from "../../src/tags/audio-tags.js";
import {
    countStatuses,
    createReport,
    processBatch,
} from "../../src/processing/batch.js";
import { captureConsole } from "../helpers/console.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { consoleLogger } from "../../src/shared/logger.js";
import type { ProcessedTrack } from "../../src/processing/types.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import { MetadataChain } from "../../src/metadata/metadata-chain.js";
import {
    createProviderServices,
    createTestChain,
} from "../helpers/metadata-chain.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

restoreFetchAfterEach();
const output = captureConsole();
const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-batch-test-"
);

test("createReport marks every file as read by its relative path", () => {
    const root = path.resolve("library");

    assert.deepEqual(
        createReport(
            [path.join(root, "a.mp3"), path.join(root, "Album", "b.flac")],
            root
        ),
        { files: { "a.mp3": "READ", [path.join("Album", "b.flac")]: "READ" } }
    );
});

test("countStatuses counts each status", () => {
    assert.deepEqual(
        countStatuses({
            files: {
                "a.mp3": "TAGGED",
                "b.mp3": "SKIPPED",
                "c.mp3": "SKIPPED",
                "d.mp3": "FAILED",
                "e.mp3": "READ",
            },
        }),
        { ok: 1, skipped: 2, errors: 1, unprocessed: 1 }
    );
});

test("processBatch clears the metadata cache once the files are processed", async () => {
    const directory = await createTemporaryDirectory();
    const broken = path.join(directory, "broken.flac");
    await fs.writeFile(broken, "not really flac");
    const report = createReport([broken], directory);
    const metadataChain = createTestChain();
    const statusesAtClear: string[] = [];
    metadataChain.clearCache = () => {
        statusesAtClear.push(...Object.values(report.files));
    };

    await processBatch([broken], {
        context: {
            sourceRoot: directory,
            metadataChain,
            logger: consoleLogger,
        },
        report,
        stopSignal: new AbortController().signal,
    });

    assert.deepEqual(statusesAtClear, ["FAILED"]);
});

test("processBatch clears the metadata cache when processing throws", async () => {
    const directory = await createTemporaryDirectory();
    const broken = path.join(directory, "broken.flac");
    await fs.writeFile(broken, "not really flac");
    const metadataChain = createTestChain();
    let clears = 0;
    metadataChain.clearCache = () => {
        clears += 1;
    };

    await assert.rejects(
        processBatch([broken], {
            context: {
                sourceRoot: directory,
                metadataChain,
                logger: consoleLogger,
            },
            report: createReport([broken], directory),
            stopSignal: new AbortController().signal,
            onTrackProcessed: () => {
                throw new Error("listener failed");
            },
        }),
        /listener failed/
    );
    assert.equal(clears, 1);
});

test("processBatch records each file status and logs its position", async () => {
    const directory = await createTemporaryDirectory();
    const tagged = path.join(directory, "tagged.mp3");
    const broken = path.join(directory, "broken.flac");
    await fs.writeFile(tagged, "audio bytes");
    await fs.writeFile(broken, "not really flac");
    await getTagStore(tagged).write(tagged, {
        info: { title: "Title", artist: "Artist", album: "", year: "2024" },
        extras: { genre: "Rock" },
        coverData: Buffer.from("cover"),
    });
    const files = [broken, tagged];
    const report = createReport(files, directory);

    await processBatch(files, {
        context: {
            sourceRoot: directory,
            metadataChain: createTestChain(),
            logger: consoleLogger,
        },
        report,
        stopSignal: new AbortController().signal,
    });

    assert.deepEqual(report, {
        files: { "broken.flac": "FAILED", "tagged.mp3": "SKIPPED" },
    });
    await fs.access(broken);
    assert.deepEqual(
        output.logs.filter((line) => line.startsWith("\n[")),
        ["\n[1/2] broken.flac (FLAC)", "\n[2/2] tagged.mp3 (MP3)"]
    );
});

test("processBatch stops before the next file once a stop is requested", async () => {
    const directory = await createTemporaryDirectory();
    const files = ["a.mp3", "b.mp3"].map((name) => path.join(directory, name));
    await Promise.all(files.map((file) => fs.writeFile(file, "audio bytes")));
    const stop = new AbortController();
    const stoppingChain = new MetadataChain(
        [
            {
                name: "Fake",
                findMetadata: async () => {
                    stop.abort();
                    return null;
                },
            },
        ],
        [],
        createProviderServices()
    );
    const report = createReport(files, directory);

    await processBatch(files, {
        context: {
            sourceRoot: directory,
            metadataChain: stoppingChain,
            logger: consoleLogger,
        },
        report,
        stopSignal: stop.signal,
    });

    assert.deepEqual(report, {
        files: { "a.mp3": "SKIPPED", "b.mp3": "READ" },
    });
    assert.ok(
        output.logs.includes("Stopped before processing the remaining files.")
    );
});

test("processBatch logs to the context logger", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "broken.flac");
    await fs.writeFile(source, "not really flac");
    const logger = createRecordingLogger();

    await processBatch([source], {
        context: {
            sourceRoot: directory,
            metadataChain: new MetadataChain([], [], createProviderServices()),
            logger,
        },
        report: createReport([source], directory),
        stopSignal: new AbortController().signal,
    });

    assert.deepEqual(logger.infos, ["\n[1/1] broken.flac (FLAC)"]);
    assert.deepEqual(output.logs, []);
});

test("processBatch announces each processed track", async () => {
    const directory = await createTemporaryDirectory();
    const tagged = path.join(directory, "tagged.mp3");
    const broken = path.join(directory, "broken.flac");
    await fs.writeFile(tagged, "audio bytes");
    await fs.writeFile(broken, "not really flac");
    await getTagStore(tagged).write(tagged, {
        info: { title: "Title", artist: "Artist", album: "", year: "2024" },
        extras: { genre: "Rock" },
        coverData: Buffer.from("cover"),
    });
    const files = [broken, tagged];
    const results: ProcessedTrack[] = [];

    await processBatch(files, {
        context: {
            sourceRoot: directory,
            metadataChain: createTestChain(),
            logger: createRecordingLogger(),
        },
        report: createReport(files, directory),
        stopSignal: new AbortController().signal,
        onTrackProcessed: (result) => results.push(result),
    });

    assert.deepEqual(results, [
        { source: broken, status: "FAILED" },
        { source: tagged, status: "SKIPPED" },
    ]);
});
