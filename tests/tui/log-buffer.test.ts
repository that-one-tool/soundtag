import assert from "node:assert/strict";
import { test } from "node:test";
import { LogBuffer } from "../../src/tui/log-buffer.js";

test("LogBuffer keeps info and error lines in order", () => {
    const buffer = new LogBuffer();

    buffer.info("Searching");
    buffer.error("Failed");

    assert.deepEqual(buffer.getSnapshot(), [
        { id: 0, text: "Searching", isError: false },
        { id: 1, text: "Failed", isError: true },
    ]);
});

test("LogBuffer splits multi-line messages and keeps blank lines", () => {
    const buffer = new LogBuffer();

    buffer.info("Searching");
    buffer.info("\n[1/2] a.mp3\nFormat: MP3");

    assert.deepEqual(
        buffer.getSnapshot().map((line) => line.text),
        ["Searching", "", "[1/2] a.mp3", "Format: MP3"]
    );
});

test("LogBuffer collapses consecutive blank lines", () => {
    const buffer = new LogBuffer();

    buffer.info("one\n");
    buffer.info("\n  \ntwo");

    assert.deepEqual(
        buffer.getSnapshot().map((line) => line.text),
        ["one", "", "two"]
    );
});

test("LogBuffer keeps the ids of kept lines", () => {
    const buffer = new LogBuffer(2);

    buffer.info("one\n\n\ntwo");
    buffer.info("three");

    assert.deepEqual(
        buffer.getSnapshot().map((line) => line.id),
        [3, 4]
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

test("LogBuffer shows progress as a last line that the next line replaces", () => {
    const buffer = new LogBuffer();

    buffer.info("one");
    buffer.progress("MusicBrainz…");
    buffer.progress("Deezer…");
    const shown = buffer.getSnapshot().map((line) => line.text);
    buffer.info("two");

    assert.deepEqual(shown, ["one", "Deezer…"]);
    assert.deepEqual(
        buffer.getSnapshot().map((line) => line.text),
        ["one", "two"]
    );
});

test("LogBuffer drops the progress line when progress ends", () => {
    const buffer = new LogBuffer();

    buffer.progress("Deezer…");
    buffer.progress("");

    assert.deepEqual(buffer.getSnapshot(), []);
});

test("LogBuffer keeps a multi-line progress on one replaceable line", () => {
    const buffer = new LogBuffer();

    buffer.progress("one\ntwo");
    const shown = buffer.getSnapshot().map((line) => line.text);
    buffer.info("done");

    assert.deepEqual(shown, ["one two"]);
    assert.deepEqual(
        buffer.getSnapshot().map((line) => line.text),
        ["done"]
    );
});
