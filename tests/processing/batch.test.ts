import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { getTagStore } from "../../src/tags/audio-tags.js";
import {
    countStatuses,
    createReport,
    processBatch,
    type BatchRun,
} from "../../src/processing/batch.js";
import { captureConsole } from "../helpers/console.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { consoleLogger } from "../../src/shared/logger.js";
import type { ProcessedTrack } from "../../src/processing/types.js";
import type {
    AlbumData,
    AlbumFinder,
    AlbumSearch,
} from "../../src/metadata/types.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import { MetadataChain } from "../../src/metadata/metadata-chain.js";
import {
    createProviderServices,
    createTestChain,
} from "../helpers/metadata-chain.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

restoreFetchAfterEach();
const output = captureConsole();
const unusedAlbums: AlbumFinder = {
    resolve: () => assert.fail("No album should be looked up."),
};
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
        albums: unusedAlbums,
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
            albums: unusedAlbums,
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
        albums: unusedAlbums,
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
        albums: unusedAlbums,
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
        albums: unusedAlbums,
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
        albums: unusedAlbums,
        onTrackProcessed: (result) => results.push(result),
    });

    assert.deepEqual(results, [
        { source: broken, status: "FAILED" },
        { source: tagged, status: "SKIPPED" },
    ]);
});

const jazz: AlbumData = {
    album: "Jazz",
    artist: "Queen",
    year: "1978",
    genre: "Rock",
    cover: null,
    tracks: [],
    found: true,
};

function createAlbumFinder() {
    const searches: [AlbumSearch, number | undefined][] = [];
    const albums: AlbumFinder = {
        resolve: async (search, fileCount) => {
            searches.push([search, fileCount]);
            return jazz;
        },
    };
    return { albums, searches };
}

async function createAlbumFolder(filenames: string[]) {
    const root = await createTemporaryDirectory();
    const folder = path.join(root, "Queen", "Queen - Jazz");
    await fs.mkdir(folder, { recursive: true });
    const files = filenames.map((filename) => path.join(folder, filename));
    await Promise.all(files.map((file) => fs.writeFile(file, "audio bytes")));
    return { root, folder, files };
}

test("processBatch tags every track of an album folder from one lookup", async () => {
    const { folder, files } = await createAlbumFolder([
        "Queen - Mustapha.mp3",
        "Queen - Bicycle Race.mp3",
    ]);
    const { albums, searches } = createAlbumFinder();
    const report = createReport([files[0]], folder);
    const processed: ProcessedTrack[] = [];

    await processBatch([files[0]], {
        context: {
            sourceRoot: folder,
            metadataChain: createTestChain(),
            logger: consoleLogger,
        },
        albums,
        report,
        stopSignal: new AbortController().signal,
        onTrackProcessed: (result) => processed.push(result),
    });

    assert.deepEqual(searches, [[{ artist: "Queen", album: "Jazz" }, 2]]);
    for (const file of files) {
        assert.equal((await getTagStore(file).read(file)).info.album, "Jazz");
    }
    assert.deepEqual(report.files, {
        "Queen - Bicycle Race.mp3": "TAGGED",
        "Queen - Mustapha.mp3": "TAGGED",
    });
    assert.equal(processed.length, 2);
    assert.deepEqual(
        output.logs.filter((line) => line.startsWith("\n")),
        [
            "\nAlbum Queen - Jazz (2 tracks)",
            "\n[1/2] Queen - Bicycle Race.mp3 (MP3)",
            "\n[2/2] Queen - Mustapha.mp3 (MP3)",
        ]
    );
});

test("processBatch stops inside an album once a stop is requested", async () => {
    const { folder, files } = await createAlbumFolder(["a.mp3", "b.mp3"]);
    const { albums } = createAlbumFinder();
    const controller = new AbortController();
    const report = createReport(files, folder);

    await processBatch(files, {
        context: {
            sourceRoot: folder,
            metadataChain: createTestChain(),
            logger: consoleLogger,
        },
        albums,
        report,
        stopSignal: controller.signal,
        onTrackProcessed: () => controller.abort(),
    });

    assert.deepEqual(countStatuses(report), {
        ok: 1,
        skipped: 0,
        errors: 0,
        unprocessed: 1,
    });
    assert.ok(
        output.logs.includes("Stopped before processing the remaining files.")
    );
});

async function createAlbumFolders(albums: Record<string, string[]>) {
    const root = await createTemporaryDirectory();
    const files: string[] = [];
    for (const [name, filenames] of Object.entries(albums)) {
        const folder = path.join(root, "Queen", name);
        await fs.mkdir(folder, { recursive: true });
        for (const filename of filenames) {
            const file = path.join(folder, filename);
            await fs.writeFile(file, "audio bytes");
            files.push(file);
        }
    }
    return { root, files };
}

function runBatchOn(files: string[], root: string, run: Partial<BatchRun>) {
    const report = createReport(files, root);
    const done = processBatch(files, {
        context: {
            sourceRoot: root,
            metadataChain: createTestChain(),
            logger: consoleLogger,
        },
        albums: unusedAlbums,
        report,
        stopSignal: new AbortController().signal,
        ...run,
    });
    return { report, done };
}

test("processBatch looks no further album up once a stop is requested", async () => {
    const { root, files } = await createAlbumFolders({
        "Queen - Jazz": ["a.mp3"],
        "Queen - News of the World": ["b.mp3"],
    });
    const { albums, searches } = createAlbumFinder();
    const controller = new AbortController();

    const { report, done } = runBatchOn(files, root, {
        albums,
        stopSignal: controller.signal,
        onTrackProcessed: () => controller.abort(),
    });
    await done;

    assert.equal(searches.length, 1);
    assert.equal(countStatuses(report).unprocessed, 1);
});

test("processBatch fails the tracks of an album it cannot look up and goes on", async () => {
    const { root, files } = await createAlbumFolders({
        "Queen - Jazz": ["a.mp3", "b.mp3"],
    });
    const single = path.join(root, "single.flac");
    await fs.writeFile(single, "not audio");
    const albums: AlbumFinder = {
        resolve: async () => {
            throw new TypeError("lookup bug");
        },
    };

    const { report, done } = runBatchOn([...files, single], root, { albums });
    await done;

    assert.deepEqual(Object.values(report.files), [
        "FAILED",
        "FAILED",
        "FAILED",
    ]);
});

test("processBatch looks no fully tagged album up unless overwriting", async () => {
    const { root, files } = await createAlbumFolders({
        "Queen - Jazz": ["a.mp3"],
    });
    await getTagStore(files[0]).write(files[0], {
        info: { title: "A", artist: "Queen", album: "Jazz", year: "1978" },
        extras: { genre: "Rock" },
        coverData: Buffer.from("cover"),
    });
    const { albums, searches } = createAlbumFinder();

    const { report, done } = runBatchOn(files, root, { albums });
    await done;

    assert.equal(searches.length, 0);
    assert.deepEqual(Object.values(report.files), ["SKIPPED"]);
});

test("processBatch reports every file of an album, selected or not", async () => {
    const { root, files } = await createAlbumFolders({
        "Queen - Jazz": ["a.mp3", "b.mp3"],
    });
    const { albums } = createAlbumFinder();
    const controller = new AbortController();
    controller.abort();

    const { report, done } = runBatchOn([files[0]], root, {
        albums,
        stopSignal: controller.signal,
    });
    await done;

    assert.equal(countStatuses(report).unprocessed, 2);
});

test("processBatch fits no tracklist to a sibling disc folder", async () => {
    const { root, files } = await createAlbumFolders({
        "Queen - Live Killers - CD1": ["a.mp3", "b.mp3"],
    });
    const { albums, searches } = createAlbumFinder();

    await runBatchOn(files, root, { albums }).done;

    assert.deepEqual(searches, [
        [{ artist: "Queen", album: "Live Killers" }, undefined],
    ]);
});

test("processBatch announces the planned track count, album files included", async () => {
    const directory = await createTemporaryDirectory();
    const album = path.join(directory, "Queen", "Queen - Jazz");
    await fs.mkdir(album, { recursive: true });
    const tracks = ["Queen - Mustapha.mp3", "Queen - Jealousy.mp3"].map(
        (name) => path.join(album, name)
    );
    for (const track of tracks) {
        await fs.writeFile(track, "audio bytes");
    }
    const totals: number[] = [];

    await processBatch([tracks[0]], {
        context: {
            sourceRoot: directory,
            metadataChain: createTestChain(),
            logger: createRecordingLogger(),
        },
        report: createReport([tracks[0]], directory),
        stopSignal: AbortSignal.abort(),
        albums: unusedAlbums,
        onPlanned: (total) => totals.push(total),
    });

    assert.deepEqual(totals, [2]);
});
