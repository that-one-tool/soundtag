import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

export interface Clock {
    now(): number;
    sleep(milliseconds: number): Promise<unknown>;
}

export type RateLimiter = <T>(task: () => Promise<T>) => Promise<T>;

export const systemClock: Clock = {
    now: () => performance.now(),
    sleep: (milliseconds) => delay(milliseconds),
};

export type WaitListener = (milliseconds: number) => void;

// Reports the time actually slept, which an instant test clock keeps at zero.
export async function sleepAndReport(
    clock: Clock,
    milliseconds: number,
    onWait: WaitListener
): Promise<void> {
    if (milliseconds <= 0) {
        return;
    }

    const startedAt = clock.now();
    await clock.sleep(milliseconds);
    onWait(clock.now() - startedAt);
}

// Timers can wake a millisecond early; a clock that does not move (tests) ends the wait.
async function waitUntilAllowed(
    clock: Clock,
    getRemainingWait: () => number,
    onWait: WaitListener
): Promise<void> {
    let remainingWait = getRemainingWait();
    while (remainingWait > 0) {
        const sleptFrom = clock.now();
        await sleepAndReport(clock, remainingWait, onWait);
        if (clock.now() === sleptFrom) {
            return;
        }
        remainingWait = getRemainingWait();
    }
}

export function createRateLimiter(
    interval: number,
    clock: Clock = systemClock,
    onWait: WaitListener = () => undefined
): RateLimiter {
    let lastStartedAt = Number.NEGATIVE_INFINITY;
    let queue: Promise<unknown> = Promise.resolve();
    const getRemainingWait = () =>
        Math.ceil(interval - (clock.now() - lastStartedAt));

    async function runWhenAllowed<T>(task: () => Promise<T>): Promise<T> {
        await waitUntilAllowed(clock, getRemainingWait, onWait);
        lastStartedAt = clock.now();
        return task();
    }

    return (task) => {
        const run = queue.then(() => runWhenAllowed(task));
        queue = run.catch(() => undefined);
        return run;
    };
}
