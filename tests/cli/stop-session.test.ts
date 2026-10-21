import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { openStopSession } from "../../src/cli/stop-session.js";
import { createFakeClock } from "../helpers/clock.js";
import { captureConsole } from "../helpers/console.js";

const output = captureConsole();

test("openStopSession stops listening for SIGINT once closed", () => {
    const listenersBefore = process.listenerCount("SIGINT");

    const session = openStopSession();
    assert.equal(process.listenerCount("SIGINT"), listenersBefore + 1);
    session.close();

    assert.equal(process.listenerCount("SIGINT"), listenersBefore);
    assert.equal(session.renewStopSignal().aborted, false);
});

test("openStopSession aborts the current stop signal on SIGINT", () => {
    const session = openStopSession();

    try {
        const firstSignal = session.renewStopSignal();
        process.emit("SIGINT");

        assert.equal(firstSignal.aborted, true);
        assert.deepEqual(output.logs, [
            "\nInterrupted. Press Ctrl+C again to quit immediately.",
        ]);
        assert.equal(session.renewStopSignal().aborted, false);
    } finally {
        session.close();
    }
});

function recordExitCodes(context: TestContext): unknown[] {
    const exitCodes: unknown[] = [];
    context.mock.method(process, "exit", (code?: unknown) => {
        exitCodes.push(code);
        return undefined as never;
    });
    return exitCodes;
}

test("openStopSession quits with code 130 on a later second SIGINT", (context) => {
    const exitCodes = recordExitCodes(context);
    const clock = createFakeClock();
    const session = openStopSession(clock);

    try {
        process.emit("SIGINT");
        clock.advance(1000);
        process.emit("SIGINT");

        assert.deepEqual(exitCodes, [130]);
    } finally {
        session.close();
    }
});

// npm forwards the terminal's SIGINT, so one key press can arrive twice.
test("openStopSession treats an immediate repeat as the same Ctrl+C", (context) => {
    const exitCodes = recordExitCodes(context);
    const clock = createFakeClock();
    const session = openStopSession(clock);

    try {
        const signal = session.renewStopSignal();
        process.emit("SIGINT");
        clock.advance(50);
        process.emit("SIGINT");

        assert.equal(signal.aborted, true);
        assert.deepEqual(exitCodes, []);
        assert.equal(output.logs.length, 1);
    } finally {
        session.close();
    }
});
