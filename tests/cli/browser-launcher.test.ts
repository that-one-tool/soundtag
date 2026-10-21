import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createBrowserLauncher,
    isInteractiveTerminal,
    runTuiLazily,
    type BrowserTerminal,
} from "../../src/cli/browser-launcher.js";
import type { TuiOptions } from "../../src/tui/run-tui.js";
import { createFakeTerminal, waitForInput } from "../helpers/ink.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-browser-launcher-test-"
);

function createTerminal() {
    const events: string[] = [];
    const terminal: BrowserTerminal = {
        release: () => events.push("release"),
        exit: (code) => events.push(`exit ${code}`),
    };
    return { terminal, events };
}

function createOptions(startDirectory: string): TuiOptions {
    return {
        startDirectory,
        lastFmApiKey: "key",
        verbose: false,
        recursive: true,
        renameFiles: true,
        fixTags: false,
        musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
    };
}

test("isInteractiveTerminal needs an interactive stdin and stdout", () => {
    assert.equal(
        isInteractiveTerminal({
            stdin: { isTTY: true },
            stdout: { isTTY: true },
        }),
        true
    );
    assert.equal(
        isInteractiveTerminal({ stdin: {}, stdout: { isTTY: true } }),
        false
    );
    assert.equal(
        isInteractiveTerminal({
            stdin: { isTTY: true },
            stdout: { isTTY: false },
        }),
        false
    );
});

test("the launcher releases the terminal, then runs the browser", async () => {
    const { terminal, events } = createTerminal();
    const options = createOptions("/music");
    const launch = createBrowserLauncher(terminal, async (received) => {
        assert.equal(received, options);
        events.push("browse");
        return "failure";
    });

    assert.equal(await launch(options), "failure");
    assert.deepEqual(events, ["release", "browse"]);
});

test("the launcher exits with 130 when the browser was forced to quit", async () => {
    const { terminal, events } = createTerminal();
    const launch = createBrowserLauncher(terminal, async () => "forced");

    await launch(createOptions("/music"));

    assert.deepEqual(events, ["release", "exit 130"]);
});

test("runTuiLazily loads and runs the terminal UI", async () => {
    const { stdin, streams } = createFakeTerminal();

    const outcome = runTuiLazily(
        createOptions(await createTemporaryDirectory()),
        streams
    );
    await waitForInput(stdin);
    stdin.write("q");

    assert.equal(await outcome, "success");
});
