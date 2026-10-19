import assert from "node:assert/strict";
import { test } from "node:test";
import { openTerminalSession } from "../src/terminal.js";

test("openTerminalSession stops listening for SIGINT once closed", () => {
    const listenersBefore = process.listenerCount("SIGINT");

    const session = openTerminalSession();
    assert.equal(process.listenerCount("SIGINT"), listenersBefore + 1);
    session.close();

    assert.equal(process.listenerCount("SIGINT"), listenersBefore);
    assert.equal(session.stopSignal.aborted, false);
});
