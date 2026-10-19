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

async function renderApp(directory: string) {
    const { services, jobs, deletedReports } = createControlledServices();
    const instance = render(
        createElement(App, { startDirectory: directory, services })
    );
    await waitForFrame(instance.lastFrame, "song.mp3");
    return { ...instance, services, jobs, deletedReports };
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

test("App deletes the report of the folder being browsed with d", async () => {
    const directory = await createLibrary();
    const { stdin, deletedReports } = await renderApp(directory);

    stdin.write("d");

    await waitFor(() => deletedReports.length === 1);
    assert.deepEqual(deletedReports, [directory]);
});

test("App keeps the report while a job is running", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin, jobs, deletedReports } =
        await renderApp(directory);
    stdin.write("a");
    await waitFor(() => jobs.length === 1);

    stdin.write("d");

    await waitForFrame(lastFrame, "Cannot delete the report while tagging.");
    assert.deepEqual(deletedReports, []);
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
    assert.deepEqual(jobs[0].target, { kind: "folder", path: directory });
});

test("App ignores tag keys while quitting", async () => {
    const directory = await createLibrary();
    const { lastFrame, stdin, jobs, services } = await renderApp(directory);
    services.queue.enqueue({
        kind: "folder",
        path: path.join(directory, "Album"),
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
