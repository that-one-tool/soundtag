import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { renderTui, runTui } from "../../src/tui/run-tui.js";
import {
    createFakeTerminal,
    KEYS,
    waitFor,
    waitForInput,
} from "../helpers/ink.js";
import { createControlledServices } from "../helpers/tui.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-run-tui-test-"
);

async function startTui() {
    const directory = await createTemporaryDirectory();
    const { services, jobs } = createControlledServices();
    const { stdin, streams } = createFakeTerminal();
    const outcome = renderTui(services, directory, streams);
    await waitForInput(stdin);
    return { stdin, services, jobs, outcome, directory };
}

test("renderTui quits successfully with q when idle", async () => {
    const { stdin, outcome } = await startTui();

    stdin.write("q");

    assert.equal(await outcome, "success");
});

test("renderTui quits with Ctrl+C too", async () => {
    const { stdin, outcome } = await startTui();

    stdin.write(KEYS.ctrlC);

    assert.equal(await outcome, "success");
});

test("renderTui reports a failure when a job failed", async () => {
    const { stdin, outcome, services, jobs, directory } = await startTui();
    services.queue.enqueue({
        kind: "folder",
        path: directory,
        recursive: true,
    });
    jobs[0].finish(false);
    await services.queue.whenIdle();

    stdin.write("q");

    assert.equal(await outcome, "failure");
});

test("renderTui waits for the current file before quitting", async () => {
    const { stdin, outcome, services, jobs, directory } = await startTui();
    services.queue.enqueue({
        kind: "folder",
        path: directory,
        recursive: true,
    });
    let settled = false;
    void outcome.then(() => (settled = true));

    stdin.write("q");
    await waitFor(() => jobs[0].stopSignal.aborted);
    await delay(50);
    assert.equal(settled, false);
    jobs[0].finish(true);

    assert.equal(await outcome, "success");
});

test("renderTui forces the quit when asked twice during a run", async () => {
    const { stdin, outcome, services, directory } = await startTui();
    services.queue.enqueue({
        kind: "folder",
        path: directory,
        recursive: true,
    });

    stdin.write("q");
    await new Promise(setImmediate);
    stdin.write("q");

    assert.equal(await outcome, "forced");
});

test("runTui wires the services and browses the start directory", async () => {
    const directory = await createTemporaryDirectory();
    const { stdin, streams } = createFakeTerminal();

    const outcome = runTui(
        {
            startDirectory: directory,
            lastFmApiKey: "key",
            verbose: false,
            recursive: true,
            renameFiles: true,
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
        },
        streams
    );
    await waitForInput(stdin);
    stdin.write("q");

    assert.equal(await outcome, "success");
});
