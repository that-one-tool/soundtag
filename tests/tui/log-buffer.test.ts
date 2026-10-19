import assert from "node:assert/strict";
import { test } from "node:test";
import { LogBuffer } from "../../src/tui/log-buffer.js";

test("LogBuffer keeps info and error lines in order", () => {
    const buffer = new LogBuffer();

    buffer.info("Searching");
    buffer.error("Failed");

    assert.deepEqual(buffer.getSnapshot(), [
        { text: "Searching", isError: false },
        { text: "Failed", isError: true },
    ]);
});

test("LogBuffer splits multi-line messages and drops blank lines", () => {
    const buffer = new LogBuffer();

    buffer.info("\n[1/2] a.mp3\nFormat: MP3");

    assert.deepEqual(
        buffer.getSnapshot().map((line) => line.text),
        ["[1/2] a.mp3", "Format: MP3"]
    );
});

test("LogBuffer keeps only the most recent lines", () => {
    const buffer = new LogBuffer(2);

    buffer.info("one");
    buffer.info("two");
    buffer.info("three");

    assert.deepEqual(
        buffer.getSnapshot().map((line) => line.text),
        ["two", "three"]
    );
});

test("LogBuffer notifies subscribers with a new snapshot", () => {
    const buffer = new LogBuffer();
    const before = buffer.getSnapshot();
    let notifications = 0;
    buffer.subscribe(() => notifications++);

    buffer.info("line");

    assert.equal(notifications, 1);
    assert.notEqual(buffer.getSnapshot(), before);
});
