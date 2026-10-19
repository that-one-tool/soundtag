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
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import { MetadataChain } from "../../src/metadata/metadata-chain.js";
import { createTestChain } from "../helpers/metadata-chain.js";
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

test("countStatuses counts processed files and ignores unread ones", () => {
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
        { ok: 1, skipped: 2, errors: 1 }
    );
});

test("processBatch records each file status and logs its position", async () => {
    const directory = await createTemporaryDirectory();
    const tagged = path.join(directory, "tagged.mp3");
    const broken = path.join(directory, "broken.flac");
    await fs.writeFile(tagged, "audio bytes");
    await fs.writeFile(broken, "not really flac");
    await getTagStore(tagged).write(tagged, {
        info: { title: "Title", artist: "Artist", album: "", year: "2024" },
        coverData: Buffer.from("cover"),
    });
    const files = [broken, tagged];
    const report = createReport(files, directory);

    await processBatch(files, {
        context: { sourceRoot: directory, metadataChain: createTestChain() },
        report,
        stopSignal: new AbortController().signal,
        renameFiles: true,
    });

    assert.deepEqual(report, {
        files: { "broken.flac": "FAILED", "tagged.mp3": "SKIPPED" },
        renamed: { "tagged.mp3": "Artist - Title.mp3" },
    });
    await fs.access(broken);
    assert.deepEqual(
        output.logs.filter((line) => /^\n?\[|^Format:/.test(line)),
        [
            "\n[1/2] broken.flac",
            "Format: FLAC",
            "\n[2/2] tagged.mp3",
            "Format: MP3",
        ]
    );
});

test("processBatch stops before the next file once a stop is requested", async () => {
    const directory = await createTemporaryDirectory();
    const files = ["a.mp3", "b.mp3"].map((name) => path.join(directory, name));
    await Promise.all(files.map((file) => fs.writeFile(file, "audio bytes")));
    const stop = new AbortController();
    const stoppingChain = new MetadataChain([
        {
            findMetadata: async () => {
                stop.abort();
                return null;
            },
        },
    ]);
    const report = createReport(files, directory);

    await processBatch(files, {
        context: { sourceRoot: directory, metadataChain: stoppingChain },
        report,
        stopSignal: stop.signal,
        renameFiles: true,
    });

    assert.deepEqual(report, {
        files: { "a.mp3": "SKIPPED", "b.mp3": "READ" },
    });
    assert.ok(
        output.logs.includes("Stopped before processing the remaining files.")
    );
});

test("processBatch keeps file names when renaming is disabled", async () => {
    const directory = await createTemporaryDirectory();
    const tagged = path.join(directory, "tagged.mp3");
    await fs.writeFile(tagged, "audio bytes");
    await getTagStore(tagged).write(tagged, {
        info: { title: "Title", artist: "Artist", album: "A", year: "2024" },
        coverData: Buffer.from("cover"),
    });
    const report = createReport([tagged], directory);

    await processBatch([tagged], {
        context: { sourceRoot: directory, metadataChain: createTestChain() },
        report,
        stopSignal: new AbortController().signal,
        renameFiles: false,
    });

    assert.deepEqual(report, { files: { "tagged.mp3": "SKIPPED" } });
    await fs.access(tagged);
});

test("processBatch renames newly tagged files but not tracks that were not found", async () => {
    const directory = await createTemporaryDirectory();
    const found = path.join(directory, "found.mp3");
    const notFound = path.join(directory, "Daft Punk - One More Time.mp3");
    await Promise.all(
        [found, notFound].map((file) => fs.writeFile(file, "audio bytes"))
    );
    await getTagStore(notFound).write(notFound, {
        info: { title: "Track 01", artist: "Unknown", album: "", year: "" },
        coverData: null,
    });
    const chain = new MetadataChain([
        {
            findMetadata: async (search) =>
                search.title === "found"
                    ? {
                          info: {
                              title: "Title",
                              artist: "Artist",
                              album: "Album",
                              year: "2024",
                          },
                          coverData: Buffer.from("cover"),
                      }
                    : null,
        },
    ]);
    const files = [found, notFound];
    const report = createReport(files, directory);

    await processBatch(files, {
        context: { sourceRoot: directory, metadataChain: chain },
        report,
        stopSignal: new AbortController().signal,
        renameFiles: true,
    });

    assert.deepEqual(report, {
        files: {
            "found.mp3": "TAGGED",
            "Daft Punk - One More Time.mp3": "SKIPPED",
        },
        renamed: { "found.mp3": "Artist - Title.mp3" },
    });
    await fs.access(notFound);
});

test("processBatch renames only the first of two files with the same tags", async () => {
    const directory = await createTemporaryDirectory();
    const files = ["a.mp3", "b.mp3"].map((name) => path.join(directory, name));
    for (const file of files) {
        await fs.writeFile(file, `audio ${file}`);
        await getTagStore(file).write(file, {
            info: {
                title: "Title",
                artist: "Artist",
                album: "A",
                year: "2024",
            },
            coverData: Buffer.from("cover"),
        });
    }
    const report = createReport(files, directory);

    await processBatch(files, {
        context: { sourceRoot: directory, metadataChain: createTestChain() },
        report,
        stopSignal: new AbortController().signal,
        renameFiles: true,
    });

    assert.deepEqual(report.renamed, { "a.mp3": "Artist - Title.mp3" });
    await fs.access(files[1]);
    assert.ok(
        output.logs.includes("Not renamed: Artist - Title.mp3 already exists.")
    );
});
