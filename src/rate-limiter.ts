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

export function createRateLimiter(
    interval: number,
    clock: Clock = systemClock
): RateLimiter {
    let lastStartedAt = Number.NEGATIVE_INFINITY;
    let queue: Promise<unknown> = Promise.resolve();

    async function runWhenAllowed<T>(task: () => Promise<T>): Promise<T> {
        const remainingWait = interval - (clock.now() - lastStartedAt);

        if (remainingWait > 0) {
            await clock.sleep(remainingWait);
        }

        lastStartedAt = clock.now();
        return task();
    }

    return (task) => {
        const run = queue.then(() => runWhenAllowed(task));
        queue = run.catch(() => undefined);
        return run;
    };
}
