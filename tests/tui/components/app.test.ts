import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import { App } from "../../../src/tui/components/app.js";
import { getTagStore } from "../../../src/tags/audio-tags.js";
import {
    createDetailsCache,
    readEntryDetails,
} from "../../../src/tui/entry-details.js";
import type {
    BrowserEntry,
    CoverLookup,
    CoverSpot,
    EntryDetails,
} from "../../../src/tui/types.js";
import { VersionedCache } from "../../../src/tui/versioned-cache.js";
import type { EntryRenamer } from "../../../src/tui/entry-renamer.js";
import type { TagClearer } from "../../../src/tui/tag-clearer.js";
import { startRenameDraft } from "../../../src/tui/rename-draft.js";
import { CoverOverlay } from "../../../src/tui/cover-overlay.js";
import { renderTui } from "../../../src/tui/run-tui.js";
import type { TuiServices } from "../../../src/tui/tui-services.js";
import {
    createFakeTerminal,
    findFrameLine,
    KEYS,
    waitFor,
    waitForFrame,
    waitForInput,
} from "../../helpers/ink.js";
import { createControlledServices } from "../../helpers/tui.js";
import { useTemporaryDirectories } from "../../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories("soundtag-app-test-");

afterEach(() => cleanup());

async function createLibrary(): Promise<string> {
    const directory = await createTemporaryDirectory();
    await fs.mkdir(path.join(directory, "Album"));
    await fs.writeFile(path.join(directory, "Album", "inside.mp3"), "audio");
    const song = path.join(directory, "song.mp3");
    await fs.writeFile(song, "audio bytes");
    await getTagStore(song).write(song, {
        info: {
            title: "Paranoid",
            artist: "Black Sabbath",
            album: "Paranoid",
            year: "1970",
        },
        extras: {},
        coverData: null,
    });
    return directory;
}

type DetailsReader = (entry: BrowserEntry) => Promise<EntryDetails>;

async function renderApp(directory: string, readDetails?: DetailsReader) {
    const { services, jobs } = createControlledServices();
    services.detailsCache = createDetailsCache(readDetails);
    const instance = render(
        createElement(App, { startDirectory: directory, services })
    );
    await waitForFrame(instance.lastFrame, "song.mp3");
    return { ...instance, services, jobs };
}

test("App lists the folder with the cursor on the first entry", async () => {
    const directory = await createLibrary();

    const { lastFrame } = await renderApp(directory);

    assert.match(findFrameLine(lastFrame, ".."), /▸/);
    assert.match(findFrameLine(lastFrame, "Album"), /Album\//);
    assert.ok((lastFrame() ?? "").includes(directory));
    assert.ok((lastFrame() ?? "").includes("♫ soundtag"));
});

test("App shows the stored tags of the hovered file", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin } = await renderApp(directory);

    stdin.write(KEYS.down);
    stdin.write(KEYS.down);

    await waitForFrame(lastFrame, "Black Sabbath");
    assert.match(findFrameLine(lastFrame, "song.mp3"), /▸/);
    assert.ok((lastFrame() ?? "").includes("1970"));
    assert.match(findFrameLine(lastFrame, "Cover"), /no/);
    assert.match(findFrameLine(lastFrame, "MP3 ·"), /File\s+MP3 · 0 KB/);
});

test("App shows folder contents in the metadata panel", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin } = await renderApp(directory);

    stdin.write(KEYS.down);

    await waitForFrame(lastFrame, "Audio files");
    assert.match(findFrameLine(lastFrame, "Audio files"), /Audio files\s+1/);
});

test("App opens a folder and goes back to it", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin } = await renderApp(directory);

    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Audio files");
    stdin.write(KEYS.enter);
    await waitForFrame(lastFrame, "inside.mp3");
    stdin.write(KEYS.left);
    await waitForFrame(lastFrame, "song.mp3");

    assert.match(findFrameLine(lastFrame, "Album/"), /▸/);
});

test("App queues the hovered file or folder for tagging", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin, jobs } = await renderApp(directory);

    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Audio files");
    stdin.write("t");
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Black Sabbath");
    stdin.write("t");

    await waitForFrame(lastFrame, "Tagging Album · 1 queued");
    assert.deepEqual(jobs[0].target, {
        kind: "folder",
        path: path.join(directory, "Album"),
        recursive: true,
    });
});

test("App ignores tagging on the parent entry", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin, jobs } = await renderApp(directory);

    stdin.write("t");
    await waitForFrame(lastFrame, "Parent folder");

    assert.equal(jobs.length, 0);
});

test("App stops the running job with s", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin, jobs } = await renderApp(directory);
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Audio files");
    stdin.write("t");
    await waitFor(() => jobs.length === 1);

    stdin.write("s");

    await waitForFrame(lastFrame, "stopping after the current file");
    assert.equal(jobs[0].stopSignal.aborted, true);
});

test("App marks processed files and their folders with a dot", async () => {
    const directory = await createLibrary();
    const { lastFrame, services } = await renderApp(directory);

    services.statusStore.record({
        source: path.join(directory, "Album", "inside.mp3"),
        status: "FAILED",
        destination: null,
    });
    services.statusStore.record({
        source: path.join(directory, "song.mp3"),
        status: "TAGGED",
        destination: null,
    });

    await waitFor(() => findFrameLine(lastFrame, "song.mp3").includes("●"));
    assert.match(findFrameLine(lastFrame, "Album/"), /●/);
    assert.doesNotMatch(findFrameLine(lastFrame, ".."), /●/);
});

test("App marks queued entries and their folders with a dot", async () => {
    const directory = await createLibrary();
    const { lastFrame, services } = await renderApp(directory);
    const album = path.join(directory, "Album");

    services.queue.enqueue({ kind: "folder", path: album, recursive: true });

    await waitFor(() => findFrameLine(lastFrame, "Album/").includes("●"));
    assert.doesNotMatch(findFrameLine(lastFrame, "song.mp3"), /●/);
    assert.doesNotMatch(findFrameLine(lastFrame, ".."), /●/);

    services.queue.enqueue({
        kind: "file",
        path: path.join(directory, "song.mp3"),
    });
    await waitFor(() => findFrameLine(lastFrame, "song.mp3").includes("●"));
});

test("App refreshes the listing after a file is renamed", async () => {
    const directory = await createLibrary();
    const { lastFrame, services } = await renderApp(directory);
    const renamed = path.join(directory, "Black Sabbath - Paranoid.mp3");
    await fs.rename(path.join(directory, "song.mp3"), renamed);

    services.statusStore.record({
        source: path.join(directory, "song.mp3"),
        status: "TAGGED",
        destination: renamed,
    });

    await waitForFrame(lastFrame, "Black Sabbath - Paranoid.mp3");
    assert.equal(findFrameLine(lastFrame, "song.mp3"), "");
});

test("App follows the browsed folder when it is renamed", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin, services } = await renderApp(directory);
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Audio files");
    stdin.write(KEYS.enter);
    await waitForFrame(lastFrame, "inside.mp3");
    const renamed = path.join(directory, "Artist - Album");
    await fs.rename(path.join(directory, "Album"), renamed);

    services.pathMoves.record({
        source: path.join(directory, "Album"),
        destination: renamed,
    });

    await waitForFrame(lastFrame, renamed);
    stdin.write(KEYS.left);
    await waitForFrame(lastFrame, "song.mp3");
    assert.match(findFrameLine(lastFrame, "Artist - Album/"), /▸/);
});

test("App refreshes the listing after a subfolder is renamed", async () => {
    const directory = await createTemporaryDirectory();
    await fs.mkdir(path.join(directory, "Album"));
    const { services } = createControlledServices();
    services.pathMoves.subscribe((move) =>
        services.statusStore.recordMove(move)
    );
    const { lastFrame } = render(
        createElement(App, { startDirectory: directory, services })
    );
    await waitForFrame(lastFrame, "Album/");
    const renamed = path.join(directory, "Black Sabbath - Paranoid");
    await fs.rename(path.join(directory, "Album"), renamed);

    services.pathMoves.record({
        source: path.join(directory, "Album"),
        destination: renamed,
    });

    await waitForFrame(lastFrame, "Black Sabbath - Paranoid/");
    assert.equal(findFrameLine(lastFrame, "Album/"), "");
});

async function startSongRename(directory: string) {
    const app = await renderApp(directory);
    app.stdin.write(KEYS.down);
    app.stdin.write(KEYS.down);
    await waitForFrame(app.lastFrame, "Black Sabbath");
    app.stdin.write("e");
    await waitFor(
        () => !findFrameLine(app.lastFrame, "▸").includes("song.mp3")
    );
    return app;
}

test("App renames the hovered file inline with e", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin } = await startSongRename(directory);

    assert.match(findFrameLine(lastFrame, "▸"), /song.*\.mp3/);
    for (let deleted = 0; deleted < 4; deleted++) {
        stdin.write(KEYS.backspace);
    }
    stdin.write("Paranoid");
    await waitFor(() => findFrameLine(lastFrame, "▸").includes("Paranoid"));
    stdin.write(KEYS.enter);

    await waitForFrame(lastFrame, "Renamed song.mp3 to Paranoid.mp3.");
    assert.match(findFrameLine(lastFrame, "Paranoid.mp3"), /▸/);
    await fs.access(path.join(directory, "Paranoid.mp3"));
});

test("App cancels an inline rename with Escape and keeps keys for the field", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin } = await startSongRename(directory);

    stdin.write("q");
    await waitFor(() => findFrameLine(lastFrame, "▸").includes("songq"));
    stdin.write(KEYS.escape);

    await waitFor(() => findFrameLine(lastFrame, "▸").includes("song.mp3"));
    await fs.access(path.join(directory, "song.mp3"));
});

test("App cancels an inline rename with Ctrl+C without quitting", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin } = await startSongRename(directory);

    stdin.write("x");
    await waitFor(() => findFrameLine(lastFrame, "▸").includes("songx"));
    stdin.write(KEYS.ctrlC);
    await waitFor(() => findFrameLine(lastFrame, "▸").includes("song.mp3"));
    stdin.write("e");

    await waitFor(() => !findFrameLine(lastFrame, "▸").includes("song.mp3"));
});

test("App sends keys typed right after e to the name field", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin, jobs } = await renderApp(directory);
    stdin.write(KEYS.down);
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Black Sabbath");

    stdin.write("e");
    stdin.write("t");

    await waitFor(() => findFrameLine(lastFrame, "▸").includes("songt"));
    assert.equal(jobs.length, 0);
});

test("App ignores e while quitting", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin } = await renderApp(directory);
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Audio files");
    stdin.write("t");
    stdin.write("q");
    await waitForFrame(lastFrame, "quitting");

    stdin.write("e");
    await delay(50);

    assert.match(findFrameLine(lastFrame, "▸"), /Album\//);
});

test("App queues nothing while a rename is in flight", async () => {
    const directory = await createLibrary();
    const { services, jobs } = createControlledServices();
    const pendingRename: { finish?: () => void } = {};
    services.renamer = {
        startDraft: startRenameDraft,
        rename: () =>
            new Promise<void>((resolve) => (pendingRename.finish = resolve)),
    } as unknown as EntryRenamer;
    const { lastFrame, stdin } = render(
        createElement(App, { startDirectory: directory, services })
    );
    await waitForFrame(lastFrame, "song.mp3");
    stdin.write(KEYS.down);
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Black Sabbath");

    stdin.write("e");
    stdin.write(KEYS.enter);
    stdin.write("t");
    await delay(50);
    assert.equal(jobs.length, 0);
    pendingRename.finish?.();
    await delay(10);
    stdin.write("t");

    await waitFor(() => jobs.length === 1);
});

async function hoverSong(directory: string) {
    const app = await renderApp(directory);
    app.stdin.write(KEYS.down);
    app.stdin.write(KEYS.down);
    await waitForFrame(app.lastFrame, "Black Sabbath");
    return app;
}

test("App clears the hovered file's tags with D then y", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin } = await hoverSong(directory);

    stdin.write("D");
    await waitForFrame(lastFrame, "Press y to clear all tags of song.mp3.");
    stdin.write("y");

    await waitForFrame(lastFrame, "Cleared all tags of song.mp3.");
    await waitFor(() => !(lastFrame() ?? "").includes("Black Sabbath"));
});

function countLines(services: TuiServices, prefix: string): number {
    return services.logBuffer
        .getSnapshot()
        .filter(({ text }) => text.startsWith(prefix)).length;
}

test("App cancels a tag clear on any other key", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin, services } = await hoverSong(directory);
    const song = path.join(directory, "song.mp3");

    stdin.write("D");
    await waitForFrame(lastFrame, "Press y");
    stdin.write("x");
    stdin.write("y");
    stdin.write("D");
    await waitFor(() => countLines(services, "Press y") === 2);
    await waitFor(() => !services.tagClearer.isClearing());

    const tags = await getTagStore(song).read(song);
    assert.equal(tags.info.artist, "Black Sabbath");
    assert.equal(countLines(services, "Cleared"), 0);
});

test("App queues nothing while tags are being cleared", async () => {
    const directory = await createLibrary();
    const { services, jobs } = createControlledServices();
    let clearing = true;
    services.tagClearer = {
        subscribe: () => () => {},
        getSnapshot: () => 0,
        isClearing: () => clearing,
        disarm: () => {},
        request: () => {},
        confirm: async () => {},
    } as unknown as TagClearer;
    const { lastFrame, stdin } = render(
        createElement(App, { startDirectory: directory, services })
    );
    await waitForFrame(lastFrame, "song.mp3");
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Audio files");

    stdin.write("t");
    await delay(50);
    assert.equal(jobs.length, 0);
    clearing = false;
    stdin.write("t");

    await waitFor(() => jobs.length === 1);
});

test("App starts no clear while a rename is in flight", async () => {
    const directory = await createLibrary();
    const { services } = createControlledServices();
    services.renamer = {
        startDraft: startRenameDraft,
        rename: () => new Promise<void>(() => {}),
    } as unknown as EntryRenamer;
    const { lastFrame, stdin } = render(
        createElement(App, { startDirectory: directory, services })
    );
    await waitForFrame(lastFrame, "song.mp3");
    stdin.write(KEYS.down);
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Black Sabbath");

    stdin.write("e");
    stdin.write(KEYS.enter);
    stdin.write("D");
    await delay(50);

    assert.ok(!(lastFrame() ?? "").includes("Press y"));
});

test("App keeps the caret and extension of a long name in view", async () => {
    const directory = await createTemporaryDirectory();
    const longName = `${"Very Long Artist Name ".repeat(5)}- Title.mp3`;
    await fs.writeFile(path.join(directory, longName), "audio");
    const { services } = createControlledServices();
    const { lastFrame, stdin } = render(
        createElement(App, { startDirectory: directory, services })
    );
    await waitForFrame(lastFrame, "Very Long");
    stdin.write(KEYS.down);
    await waitFor(() => findFrameLine(lastFrame, "▸").includes("Very Long"));

    stdin.write("e");
    stdin.write("ZZ");

    await waitFor(() => findFrameLine(lastFrame, "▸").includes("TitleZZ .mp3"));
});

test("App shows the latest log lines", async () => {
    const directory = await createLibrary();
    const { lastFrame, services } = await renderApp(directory);

    services.logBuffer.info('Searching: "Paranoid"');
    services.logBuffer.error("Last.fm search failed");

    await waitForFrame(lastFrame, "Last.fm search failed");
    assert.ok((lastFrame() ?? "").includes('Searching: "Paranoid"'));
});

test("App reports folders it cannot read", async () => {
    const directory = path.join(await createTemporaryDirectory(), "missing");
    const { services } = createControlledServices();

    const { lastFrame } = render(
        createElement(App, { startDirectory: directory, services })
    );

    await waitForFrame(lastFrame, "ENOENT");
});

test("App tags the folder being browsed with a", async () => {
    const directory = await createLibrary();
    const { stdin, jobs } = await renderApp(directory);

    stdin.write("a");

    await waitFor(() => jobs.length === 1);
    assert.deepEqual(jobs[0].target, {
        kind: "folder",
        path: directory,
        recursive: true,
    });
});

test("App keeps the subfolder choice of each queued folder", async () => {
    const directory = await createLibrary();
    await fs.mkdir(path.join(directory, "Live"));
    const { lastFrame, stdin, jobs } = await renderApp(directory);
    stdin.write("a");
    await waitFor(() => jobs.length === 1);
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Audio files");
    stdin.write("t");

    stdin.write("r");
    await waitForFrame(lastFrame, "subfolders off");
    stdin.write(KEYS.down);
    await waitFor(() => findFrameLine(lastFrame, "Live").includes("▸"));
    stdin.write("t");
    await waitForFrame(lastFrame, "2 queued");
    jobs[0].finish(true);
    await waitFor(() => jobs.length === 2);
    jobs[1].finish(true);
    await waitFor(() => jobs.length === 3);

    assert.deepEqual(
        jobs.map(({ target }) => target),
        [
            { kind: "folder", path: directory, recursive: true },
            {
                kind: "folder",
                path: path.join(directory, "Album"),
                recursive: true,
            },
            {
                kind: "folder",
                path: path.join(directory, "Live"),
                recursive: false,
            },
        ]
    );
});

test("App ignores tag keys while quitting", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin, jobs, services } = await renderApp(directory);
    services.queue.enqueue({
        kind: "folder",
        path: path.join(directory, "Album"),
        recursive: true,
    });
    stdin.write("q");
    await waitForFrame(lastFrame, "quitting after the current file");

    stdin.write("a");
    stdin.write(KEYS.down);
    stdin.write("t");
    await delay(50);

    assert.equal(jobs.length, 1);
    assert.deepEqual(services.queue.getSnapshot().pending, []);
});

test("App re-reads the hovered file once it is processed", async () => {
    const directory = await createLibrary();
    const song = path.join(directory, "song.mp3");
    const { lastFrame, stdin, services } = await renderApp(directory);
    stdin.write(KEYS.down);
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Black Sabbath");

    await getTagStore(song).write(song, {
        info: {
            title: "Iron Man",
            artist: "Black Sabbath",
            album: "Paranoid",
            year: "1970",
        },
        extras: {},
        coverData: null,
    });
    services.statusStore.record({
        source: song,
        status: "TAGGED",
        destination: null,
    });

    await waitForFrame(lastFrame, "Iron Man");
});

function createRecordingReader(): { reads: string[]; read: DetailsReader } {
    const reads: string[] = [];
    const read = (entry: BrowserEntry) => {
        reads.push(entry.name);
        return readEntryDetails(entry);
    };
    return { reads, read };
}

test("App shows a revisited file without reading it again", async () => {
    const directory = await createLibrary();
    const { reads, read } = createRecordingReader();
    const { lastFrame, stdin } = await renderApp(directory, read);
    stdin.write(KEYS.down);
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Black Sabbath");
    stdin.write(KEYS.up);
    await waitForFrame(lastFrame, "Audio files");

    stdin.write(KEYS.down);

    await waitForFrame(lastFrame, "Black Sabbath");
    assert.deepEqual(
        reads.filter((name) => name === "song.mp3"),
        ["song.mp3"]
    );
});

function readFoldersOnly(entry: BrowserEntry): Promise<EntryDetails> {
    return entry.kind === "file"
        ? new Promise<EntryDetails>(() => {})
        : readEntryDetails(entry);
}

test("App keeps the previous details while the next entry loads", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin } = await renderApp(directory, readFoldersOnly);
    stdin.write(KEYS.down);
    await waitForFrame(lastFrame, "Audio files");

    stdin.write(KEYS.down);

    await waitForFrame(lastFrame, "Metadata …");
    assert.match(findFrameLine(lastFrame, "song.mp3"), /▸/);
    assert.ok((lastFrame() ?? "").includes("Audio files"));
});

test("App does not read the files the cursor only passes over", async () => {
    const directory = await createLibrary();
    for (const name of ["t1.mp3", "t2.mp3"]) {
        await fs.writeFile(path.join(directory, name), "audio");
    }
    const { reads, read } = createRecordingReader();
    const { lastFrame, stdin } = await renderApp(directory, read);

    for (let move = 0; move < 4; move++) {
        stdin.write(KEYS.down);
        await delay(30);
    }

    await waitFor(() => !(lastFrame() ?? "").includes("Metadata …"));
    await waitForFrame(lastFrame, "Duration");
    assert.match(findFrameLine(lastFrame, "t2.mp3"), /▸/);
    assert.ok(!reads.includes("song.mp3"));
    assert.ok(!reads.includes("t1.mp3"));
});

async function readUnreadable(): Promise<EntryDetails> {
    return { kind: "unreadable", message: "EBUSY" };
}

test("App stops marking the panel once an unreadable entry is read", async () => {
    const directory = await createLibrary();
    const { lastFrame } = await renderApp(directory, readUnreadable);

    await waitForFrame(lastFrame, "Cannot read: EBUSY");

    await delay(50);
    assert.ok(!(lastFrame() ?? "").includes("Metadata …"));
});

test("App scrolls the focused log pane instead of the browser", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin, services } = await renderApp(directory);
    for (let line = 1; line <= 30; line++) {
        services.logBuffer.info(`log line ${line}`);
    }
    await waitForFrame(lastFrame, "log line 30");

    stdin.write("\t");
    stdin.write(KEYS.up);
    stdin.write(KEYS.up);

    await waitForFrame(lastFrame, "Log ↑2");
    stdin.write(KEYS.enter);
    stdin.write(KEYS.left);
    await delay(50);
    assert.ok(!(lastFrame() ?? "").includes("log line 30"));
    assert.match(findFrameLine(lastFrame, ".."), /▸/);
    assert.ok((lastFrame() ?? "").includes(directory));

    stdin.write("\t");
    stdin.write(KEYS.down);

    await waitFor(() => /▸/.test(findFrameLine(lastFrame, "Album")));
    assert.ok((lastFrame() ?? "").includes("Log ↑2"));
});

test("App reads the cover of the hovered file again once it is processed", async () => {
    const directory = await createLibrary();
    const song = path.join(directory, "song.mp3");
    const { lastFrame, stdin, services } = await renderApp(directory);
    const covers: string[] = [];
    services.coverCache = new VersionedCache<CoverLookup>(async (entry) => {
        covers.push(entry.name);
        return { kind: "missing" };
    });
    stdin.write(KEYS.down);
    await delay(30);
    stdin.write(KEYS.down);
    await waitFor(() => covers.includes("song.mp3"));

    await fs.appendFile(song, "cover added");
    services.statusStore.record({
        source: song,
        status: "TAGGED",
        destination: null,
    });

    await waitFor(
        () => covers.filter((name) => name === "song.mp3").length >= 2
    );
    await waitForFrame(lastFrame, "Black Sabbath");
});

function createRecordingOverlay() {
    const spots: CoverSpot[] = [];
    const counts = { invalidated: 0, cleared: 0 };
    const overlay = {
        show: (_cover: unknown, spot: CoverSpot) => spots.push(spot),
        hide: () => {},
        invalidate: () => counts.invalidated++,
        clear: () => counts.cleared++,
    };
    return { overlay, spots, counts };
}

test("App places the kitty cover at its spot on screen, again after a resize, and clears it on exit", async () => {
    const directory = await createLibrary();
    const { services } = createControlledServices();
    const { overlay, spots, counts } = createRecordingOverlay();
    services.coverOverlay = overlay;
    const art = { png: Buffer.from("png"), key: "png", width: 48, height: 48 };
    services.coverCache = new VersionedCache<CoverLookup>(async () => ({
        kind: "found",
        art,
    }));
    const terminal = createFakeTerminal({ columns: 120, rows: 60 });
    const outcome = renderTui(services, directory, terminal.streams);
    await waitForInput(terminal.stdin);
    await waitFor(() => terminal.stdout.output.includes("song.mp3"));
    terminal.stdin.write(KEYS.down);
    terminal.stdin.write(KEYS.down);

    await waitFor(() => spots.length > 0);
    assert.deepEqual(spots.at(-1), {
        row: 15,
        column: 70,
        columns: 46,
        rows: 23,
    });
    const invalidatedBeforeResize = counts.invalidated;
    terminal.stdout.rows = 62;
    terminal.stdout.emit("resize");
    await waitFor(() => counts.invalidated > invalidatedBeforeResize);
    terminal.stdin.write("q");
    await outcome;

    assert.equal(counts.cleared, 1);
});

test("App frees the kitty covers before leaving the alternate screen", async () => {
    const directory = await createLibrary();
    const { services } = createControlledServices();
    const terminal = createFakeTerminal({ columns: 120, rows: 60 });
    Object.assign(terminal.stdout, { isTTY: true });
    services.coverOverlay = new CoverOverlay((text) =>
        terminal.streams.stdout.write(text)
    );
    const art = { png: Buffer.from("png"), key: "png", width: 48, height: 48 };
    services.coverCache = new VersionedCache<CoverLookup>(async () => ({
        kind: "found",
        art,
    }));
    const outcome = renderTui(services, directory, terminal.streams);
    await waitForInput(terminal.stdin);
    await waitFor(() => terminal.stdout.output.includes("song.mp3"));
    terminal.stdin.write(KEYS.down);
    terminal.stdin.write(KEYS.down);
    await waitFor(() => terminal.stdout.output.includes("a=p,"));

    terminal.stdin.write("q");
    await outcome;

    const { output } = terminal.stdout;
    const freed = output.indexOf("a=d,d=I,");
    assert.ok(freed > 0);
    assert.ok(freed < output.lastIndexOf("\u001B[?1049l"));
});
