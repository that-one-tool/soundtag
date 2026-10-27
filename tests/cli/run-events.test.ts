import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createJsonEvents,
    routeConsoleToStderr,
    silentEvents,
} from "../../src/cli/run-events.js";

function recordLines(): { lines: string[]; write: (text: string) => void } {
    const lines: string[] = [];
    return { lines, write: (text) => lines.push(text) };
}

test("createJsonEvents writes one JSON line per event", () => {
    const output = recordLines();
    const events = createJsonEvents(output.write);

    events.start(2);
    events.file({ source: "/music/a.mp3", status: "TAGGED" });
    events.file({ source: "/music/b.mp3", status: "FAILED" });
    events.summary(
        { ok: 1, skipped: 0, errors: 1, unprocessed: 0 },
        { stopped: false }
    );
    events.error("Source not found: x");

    assert.deepEqual(output.lines, [
        '{"type":"start","total":2}\n',
        '{"type":"file","path":"/music/a.mp3","status":"tagged"}\n',
        '{"type":"file","path":"/music/b.mp3","status":"failed"}\n',
        '{"type":"summary","tagged":1,"skipped":0,"failed":1,"unprocessed":0,"stopped":false}\n',
        '{"type":"error","message":"Source not found: x"}\n',
    ]);
});

test("silentEvents ignores every event", () => {
    silentEvents.start(1);
    silentEvents.file({ source: "a.mp3", status: "SKIPPED" });
    silentEvents.summary(
        { ok: 0, skipped: 1, errors: 0, unprocessed: 0 },
        { stopped: true }
    );
    silentEvents.error("ignored");
});

test("routeConsoleToStderr sends console logs to stderr", () => {
    const original = globalThis.console;
    try {
        routeConsoleToStderr();
        assert.notEqual(globalThis.console, original);
    } finally {
        globalThis.console = original;
    }
});
