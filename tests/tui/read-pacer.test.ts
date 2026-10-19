import assert from "node:assert/strict";
import { test } from "node:test";
import { ReadPacer } from "../../src/tui/read-pacer.js";
import { createFakeClock } from "../helpers/clock.js";

test("ReadPacer reads at once after the cursor rested", async () => {
    const clock = createFakeClock();
    const pacer = new ReadPacer(clock);
    await pacer.wait("/a");
    clock.advance(200);

    await pacer.wait("/b");

    assert.deepEqual(clock.sleeps, [0, 0]);
});

test("ReadPacer waits for the cursor to settle while a key repeats", async () => {
    const clock = createFakeClock();
    const pacer = new ReadPacer(clock);
    await pacer.wait("/a");
    clock.advance(30);

    await pacer.wait("/b");

    assert.deepEqual(clock.sleeps, [0, 80]);
});

test("ReadPacer reads the same path again at once", async () => {
    const clock = createFakeClock();
    const pacer = new ReadPacer(clock);
    await pacer.wait("/a");
    clock.advance(30);
    await pacer.wait("/a");
    clock.advance(60);

    await pacer.wait("/b");

    assert.deepEqual(clock.sleeps, [0, 0, 0]);
});
