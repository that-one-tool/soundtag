import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { afterEach, test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import { App } from "../../../src/tui/components/app.js";
import { getTagStore } from "../../../src/tags/audio-tags.js";
import { DetailsCache } from "../../../src/tui/details-cache.js";
import { readEntryDetails } from "../../../src/tui/entry-details.js";
import type { BrowserEntry, EntryDetails } from "../../../src/tui/types.js";
import {
    findFrameLine,
    KEYS,
    waitFor,
    waitForFrame,
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
    services.detailsCache = new DetailsCache(readDetails);
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
