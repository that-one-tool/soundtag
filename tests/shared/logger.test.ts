import assert from "node:assert/strict";
import { test } from "node:test";
import { consoleLogger, createConsoleLogger } from "../../src/shared/logger.js";
import { captureConsole } from "../helpers/console.js";

const output = captureConsole();

test("consoleLogger writes info to stdout and errors to stderr", () => {
    consoleLogger.info("progress");
    consoleLogger.error("failure");

    assert.deepEqual(output.logs, ["progress"]);
    assert.deepEqual(output.errors, ["failure"]);
});

function createTerminal(isTTY: boolean) {
    const written: string[] = [];
    const terminal = {
        isTTY,
        columns: 12,
        write: (text: string) => written.push(text) > 0,
    };
    return { terminal, written };
}

test("a console logger shows progress on one rewritten terminal line", () => {
    const { terminal, written } = createTerminal(true);
    const logger = createConsoleLogger(terminal);

    logger.progress("MusicBrainz… waiting");
    logger.progress("Deezer…");
    logger.info("done");

    assert.deepEqual(written, [
        "MusicBrainz",
        "\r\u001b[2K",
        "Deezer…",
        "\r\u001b[2K",
    ]);
    assert.deepEqual(output.logs, ["done"]);
});

test("a console logger clears the progress line before an error", () => {
    const { terminal, written } = createTerminal(true);
    const logger = createConsoleLogger(terminal);

    logger.progress("Deezer…");
    logger.progress("");
    logger.error("failure");

    assert.deepEqual(written, ["Deezer…", "\r\u001b[2K"]);
    assert.deepEqual(output.errors, ["failure"]);
});

test("a console logger shows no progress when the output is not a terminal", () => {
    const { terminal, written } = createTerminal(false);

    createConsoleLogger(terminal).progress("Deezer…");

    assert.deepEqual(written, []);
});
