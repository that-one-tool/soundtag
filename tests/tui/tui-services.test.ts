import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { getTagStore } from "../../src/tags/audio-tags.js";
import { createTuiServices } from "../../src/tui/tui-services.js";
import type { PathMove } from "../../src/shared/paths.js";
import type { BrowserEntry } from "../../src/tui/types.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";
import { DEFAULT_JOB_SETTINGS } from "../helpers/tui.js";

restoreFetchAfterEach();
const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-tui-services-test-"
);

test("createTuiServices routes job results to the status store and logs", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Artist - Title.mp3");
    await fs.writeFile(source, "audio bytes");
    globalThis.fetch = async () => new Response(null, { status: 500 });
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: true,
        renameFiles: false,
        fixTags: false,
        musicBrainzUserAgent: " ",
        startDirectory: directory,
    });

    services.queue.enqueue({
        kind: "file",
        path: source,
        settings: DEFAULT_JOB_SETTINGS,
    });
    await services.queue.whenIdle();

    assert.equal(services.statusStore.getSnapshot().get(source), "SKIPPED");
    const logText = services.logBuffer.getSnapshot().map((line) => line.text);
    assert.ok(
        logText.includes(
            "MusicBrainz and ListenBrainz require MUSICBRAINZ_USER_AGENT."
        )
    );
    assert.ok(logText.some((text) => text.startsWith("Searching:")));
});

test("createTuiServices marks files as redone only once their new status is recorded", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Artist - Title.mp3");
    await fs.writeFile(source, "audio bytes");
    globalThis.fetch = async () => new Response(null, { status: 500 });
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: true,
        renameFiles: false,
        fixTags: false,
        startDirectory: directory,
    });
    services.statusStore.record({
        source,
        status: "FAILED",
        destination: null,
    });
    const seen: string[] = [];
    const isRedone = () => services.redoneFiles.getSnapshot().has(source);
    services.statusStore.subscribe(() =>
        seen.push(
            `${services.statusStore.getSnapshot().get(source)}:${isRedone()}`
        )
    );
    services.redoneFiles.subscribe(() => seen.push(`redone:${isRedone()}`));

    services.queue.enqueue({
        kind: "file",
        path: source,
        settings: DEFAULT_JOB_SETTINGS,
    });
    await services.queue.whenIdle();

    assert.deepEqual(seen, ["SKIPPED:false", "redone:true", "redone:false"]);
});

test("createTuiServices forgets redone files when a job fails", async () => {
    const directory = await createTemporaryDirectory();
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: true,
        renameFiles: false,
        fixTags: false,
        startDirectory: directory,
    });
    services.redoneFiles.add(path.join(directory, "song.mp3"));

    services.queue.enqueue({
        kind: "folder",
        path: path.join(directory, "missing"),
        recursive: true,
        settings: DEFAULT_JOB_SETTINGS,
    });
    await services.queue.whenIdle();

    assert.equal(services.redoneFiles.getSnapshot().size, 0);
});

test("createTuiServices starts the subfolder choice from the options", () => {
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: false,
        renameFiles: false,
        fixTags: false,
        startDirectory: process.cwd(),
    });

    assert.equal(services.subfolders.getSnapshot(), false);
});

test("createTuiServices logs tag clears and checks them against the queue", async () => {
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: false,
        renameFiles: false,
        fixTags: false,
        startDirectory: process.cwd(),
    });
    const folder = path.join(await createTemporaryDirectory(), "missing");
    const song: BrowserEntry = {
        name: "song.mp3",
        path: path.join(folder, "song.mp3"),
        kind: "file",
    };
    services.queue.enqueue({
        kind: "folder",
        path: folder,
        recursive: false,
        settings: DEFAULT_JOB_SETTINGS,
    });

    await services.tagClearer.request(song);
    await services.queue.whenIdle();

    const lines = services.logBuffer.getSnapshot().map(({ text }) => text);
    assert.ok(lines.includes("Not cleared: song.mp3 is queued for tagging."));
});

test("createTuiServices moves statuses and queued targets of a renamed album folder", async () => {
    const directory = await createTemporaryDirectory();
    const album = path.join(directory, "old");
    const [source, other] = ["Title", "Other"].map((title) =>
        path.join(album, `Artist - ${title}.mp3`)
    );
    await fs.mkdir(album);
    for (const [file, title] of [
        [source, "Title"],
        [other, "Other"],
    ]) {
        await fs.writeFile(file, "audio bytes");
        await getTagStore(file).write(file, {
            info: { title, artist: "Artist", album: "Album", year: "2024" },
            extras: {},
            coverData: Buffer.from("cover"),
        });
    }
    globalThis.fetch = async () => new Response(null, { status: 500 });
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: false,
        renameFiles: true,
        fixTags: false,
        startDirectory: directory,
    });
    const moves: PathMove[] = [];
    services.pathMoves.subscribe((move) => moves.push(move));

    services.queue.enqueue({
        kind: "folder",
        path: album,
        recursive: false,
        settings: DEFAULT_JOB_SETTINGS,
    });
    services.queue.enqueue({
        kind: "file",
        path: source,
        settings: DEFAULT_JOB_SETTINGS,
    });
    await services.queue.whenIdle();

    const renamed = path.join(directory, "Artist - Album");
    assert.deepEqual(moves, [{ source: album, destination: renamed }]);
    assert.deepEqual(
        [...services.statusStore.getSnapshot().keys()].toSorted(),
        [
            path.join(renamed, "Artist - Other.mp3"),
            path.join(renamed, "Artist - Title.mp3"),
        ]
    );
    const logText = services.logBuffer.getSnapshot().map((line) => line.text);
    assert.ok(!logText.some((text) => text.includes("no longer exists")));
});

test("createTuiServices draws no covers by default", async () => {
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: false,
        renameFiles: false,
        fixTags: false,
        startDirectory: process.cwd(),
    });
    const entry = {
        name: "a.mp3",
        path: "/missing/a.mp3",
        kind: "file" as const,
    };

    services.coverOverlay.show(
        { png: Buffer.from("png"), key: "png", width: 2, height: 2 },
        {
            row: 0,
            column: 0,
            columns: 2,
            rows: 1,
        }
    );

    assert.deepEqual(await services.coverCache.read(entry), {
        kind: "missing",
    });
});

test("createTuiServices starts the renaming choice from the options", () => {
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: true,
        renameFiles: false,
        fixTags: false,
        startDirectory: process.cwd(),
    });

    assert.equal(services.renaming.getSnapshot(), false);
});

test("createTuiServices starts the fixing choice from the options", () => {
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: true,
        renameFiles: true,
        fixTags: true,
        startDirectory: process.cwd(),
    });

    assert.equal(services.fixing.getSnapshot(), true);
});
