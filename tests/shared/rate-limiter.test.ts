import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createRateLimiter,
    systemClock,
} from "../../src/shared/rate-limiter.js";
import { createFakeClock } from "../helpers/clock.js";

test("createRateLimiter runs the first task without waiting", async () => {
    const clock = createFakeClock();
    const schedule = createRateLimiter(1000, clock);

    assert.equal(await schedule(async () => "done"), "done");
    assert.deepEqual(clock.sleeps, []);
});

test("createRateLimiter waits for the remaining interval between tasks", async () => {
    const clock = createFakeClock();
    const schedule = createRateLimiter(1000, clock);

    await schedule(async () => clock.advance(300));
    await schedule(async () => undefined);

    assert.deepEqual(clock.sleeps, [700]);
});

test("createRateLimiter does not wait once the interval has elapsed", async () => {
    const clock = createFakeClock();
    const schedule = createRateLimiter(1000, clock);

    await schedule(async () => undefined);
    clock.advance(1500);
    await schedule(async () => undefined);

    assert.deepEqual(clock.sleeps, []);
});

test("createRateLimiter runs concurrent tasks one at a time", async () => {
    const clock = createFakeClock();
    const schedule = createRateLimiter(0, clock);
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });

    const first = schedule(async () => {
        events.push("first started");
        await firstBlocked;
        events.push("first finished");
    });
    const second = schedule(async () => {
        events.push("second started");
    });
    await new Promise((resolve) => setImmediate(resolve));
    releaseFirst();
    await Promise.all([first, second]);

    assert.deepEqual(events, [
        "first started",
        "first finished",
        "second started",
    ]);
});

test("createRateLimiter keeps scheduling after a task fails", async () => {
    const clock = createFakeClock();
    const schedule = createRateLimiter(1000, clock);

    await assert.rejects(
        schedule(async () => {
            throw new Error("failed task");
        }),
        /failed task/
    );
    assert.equal(await schedule(async () => "next"), "next");
});

test("systemClock sleeps for the requested time on a monotonic clock", async () => {
    const startedAt = systemClock.now();

    await systemClock.sleep(20);

    assert.ok(systemClock.now() - startedAt >= 15);
});

test("createRateLimiter reports each wait", async () => {
    const clock = createFakeClock();
    const waits: number[] = [];
    const schedule = createRateLimiter(1000, clock, (milliseconds) =>
        waits.push(milliseconds)
    );

    await schedule(async () => clock.advance(300));
    await schedule(async () => undefined);

    assert.deepEqual(waits, [700]);
});

// Node timers can wake a millisecond early, but always move the clock.
function createEarlyClock() {
    const clock = createFakeClock();
    return {
        ...clock,
        async sleep(milliseconds: number) {
            clock.sleeps.push(milliseconds);
            clock.advance(Math.max(milliseconds - 1, 1));
        },
    };
}

test("createRateLimiter waits again when its timer wakes early", async () => {
    const clock = createEarlyClock();
    const schedule = createRateLimiter(1000, clock);
    const startedAt: number[] = [];

    await schedule(async () => startedAt.push(clock.now()));
    await schedule(async () => startedAt.push(clock.now()));

    assert.ok(startedAt[1] - startedAt[0] >= 1000);
    assert.deepEqual(clock.sleeps, [1000, 1]);
});

test("createRateLimiter does not wait forever with a clock that never moves", async () => {
    const sleeps: number[] = [];
    const frozenClock = {
        now: () => 0,
        sleep: async (milliseconds: number) => sleeps.push(milliseconds),
    };
    const schedule = createRateLimiter(1000, frozenClock);

    await schedule(async () => undefined);
    await schedule(async () => undefined);

    assert.deepEqual(sleeps, [1000]);
});
