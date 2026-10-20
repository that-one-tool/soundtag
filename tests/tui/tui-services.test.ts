import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { getTagStore } from "../../src/tags/audio-tags.js";
import { createTuiServices } from "../../src/tui/tui-services.js";
import type { PathMove } from "../../src/shared/paths.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

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
        musicBrainzUserAgent: " ",
        startDirectory: directory,
    });

    services.queue.enqueue({ kind: "file", path: source });
    await services.queue.whenIdle();

    assert.equal(services.statusStore.getSnapshot().get(source), "SKIPPED");
    const logText = services.logBuffer.getSnapshot().map((line) => line.text);
    assert.ok(
        logText.includes(
            "MusicBrainz fallback requires MUSICBRAINZ_USER_AGENT."
        )
    );
    assert.ok(logText.some((text) => text.startsWith("Searching:")));
});

test("createTuiServices starts the subfolder choice from the options", () => {
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: false,
        renameFiles: false,
        startDirectory: process.cwd(),
    });

    assert.equal(services.subfolders.getSnapshot(), false);
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
        startDirectory: directory,
    });
    const moves: PathMove[] = [];
    services.pathMoves.subscribe((move) => moves.push(move));

    services.queue.enqueue({ kind: "folder", path: album, recursive: false });
    services.queue.enqueue({ kind: "file", path: source });
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
