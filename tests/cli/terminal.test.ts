import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { openTerminalSession } from "../../src/cli/terminal.js";
import { InputCancelledError } from "../../src/shared/errors.js";
import { captureConsole } from "../helpers/console.js";

const output = captureConsole();

function openTestSession() {
    const input = new PassThrough();
    const session = openTerminalSession({ input, output: new PassThrough() });
    return { input, session };
}

test("openTerminalSession stops listening for SIGINT once closed", () => {
    const listenersBefore = process.listenerCount("SIGINT");

    const { session } = openTestSession();
    assert.equal(process.listenerCount("SIGINT"), listenersBefore + 1);
    session.close();

    assert.equal(process.listenerCount("SIGINT"), listenersBefore);
    assert.equal(session.renewStopSignal().aborted, false);
});

test("openTerminalSession cancels a prompt on SIGINT with a neutral message", async () => {
    const { session } = openTestSession();

    try {
        const answer = session.ask("Question: ");
        process.emit("SIGINT");

        await assert.rejects(answer, InputCancelledError);
        assert.deepEqual(output.logs, ["\nInterrupted."]);
    } finally {
        session.close();
    }
});

test("openTerminalSession answers prompts again after renewing the stop signal", async () => {
    const { input, session } = openTestSession();

    try {
        const firstSignal = session.renewStopSignal();
        process.emit("SIGINT");
        assert.equal(firstSignal.aborted, true);
        assert.deepEqual(output.logs, [
            "\nInterrupted. Press Ctrl+C again to quit immediately.",
        ]);

        assert.equal(session.renewStopSignal().aborted, false);
        const answer = session.ask("Question: ");
        input.write("yes\n");
        assert.equal(await answer, "yes");
    } finally {
        session.close();
    }
});
