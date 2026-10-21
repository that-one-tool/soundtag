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

export function createRateLimiter(
    interval: number,
    clock: Clock = systemClock,
    onWait: WaitListener = () => undefined
): RateLimiter {
    let lastStartedAt = Number.NEGATIVE_INFINITY;
    let queue: Promise<unknown> = Promise.resolve();

    async function runWhenAllowed<T>(task: () => Promise<T>): Promise<T> {
        const remainingWait = interval - (clock.now() - lastStartedAt);
        await sleepAndReport(clock, remainingWait, onWait);
        lastStartedAt = clock.now();
        return task();
    }

    return (task) => {
        const run = queue.then(() => runWhenAllowed(task));
        queue = run.catch(() => undefined);
        return run;
    };
}
