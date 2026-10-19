import assert from "node:assert/strict";
import { test } from "node:test";
import { createRateLimiter, type Clock } from "../src/rate-limiter.js";

function createFakeClock(): Clock & {
    sleeps: number[];
    advance(ms: number): void;
} {
    let currentTime = 0;
    const sleeps: number[] = [];

    return {
        sleeps,
        now: () => currentTime,
        advance(ms) {
            currentTime += ms;
        },
        async sleep(ms) {
            sleeps.push(ms);
            currentTime += ms;
        },
    };
}

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
