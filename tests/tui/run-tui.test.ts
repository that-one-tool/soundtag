import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
    createCoverDisplay,
    hasTrueColor,
    renderTui,
    runTui,
} from "../../src/tui/run-tui.js";
import {
    createFakeTerminal,
    KEYS,
    waitFor,
    waitForInput,
} from "../helpers/ink.js";
import {
    createControlledServices,
    DEFAULT_JOB_SETTINGS,
} from "../helpers/tui.js";
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
        settings: DEFAULT_JOB_SETTINGS,
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
        settings: DEFAULT_JOB_SETTINGS,
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
        settings: DEFAULT_JOB_SETTINGS,
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
            overwrite: false,
            recursive: true,
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
        },
        streams
    );
    await waitForInput(stdin);
    stdin.write("q");

    assert.equal(await outcome, "success");
});

function createStdoutWithDepth(depth: number): NodeJS.WriteStream {
    return { getColorDepth: () => depth } as unknown as NodeJS.WriteStream;
}

test("hasTrueColor needs a terminal with 24-bit colors", () => {
    assert.equal(hasTrueColor(createStdoutWithDepth(24)), true);
    assert.equal(hasTrueColor(createStdoutWithDepth(8)), false);
    assert.equal(hasTrueColor({} as NodeJS.WriteStream), false);
});

function createReplyingStreams(writes: string[]) {
    const replies: string[] = [];
    const stdin = Object.assign(new EventEmitter(), {
        isTTY: true,
        setRawMode: () => {},
        read: () => replies.shift() ?? null,
    });
    const stdout = {
        getColorDepth: () => 24,
        write: (text: string) => {
            writes.push(text);
            if (text === "\u001B[16t") {
                replies.push("\u001B[6;18;8t");
                stdin.emit("readable");
            }
            return true;
        },
    };
    return {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
    };
}

const COVER_OPTIONS = {
    startDirectory: process.cwd(),
    lastFmApiKey: "key",
    verbose: false,
    overwrite: false,
    recursive: true,
};

test("createCoverDisplay detects the mode, measures cells and writes images to stdout", async () => {
    const writes: string[] = [];
    const streams = createReplyingStreams(writes);

    const display = await createCoverDisplay(COVER_OPTIONS, streams, {
        TERM: "xterm-kitty",
    });
    display.writeToTerminal("image");

    assert.equal(display.mode, "kitty");
    assert.equal(display.cellRatio, 2.25);
    assert.deepEqual(writes, ["\u001B[16t", "image"]);
});

test("createCoverDisplay keeps two pixels per row without kitty graphics", async () => {
    const writes: string[] = [];
    const streams = createReplyingStreams(writes);

    const display = await createCoverDisplay(
        { ...COVER_OPTIONS, coverMode: "none" },
        streams,
        {}
    );

    assert.equal(display.mode, "none");
    assert.equal(display.cellRatio, 2);
    assert.deepEqual(writes, []);
});
