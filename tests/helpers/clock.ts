import type { Clock } from "../../src/rate-limiter.js";

export const instantClock: Clock = {
    now: () => 0,
    sleep: async () => undefined,
};

export function createFakeClock(): Clock & {
    sleeps: number[];
    advance(milliseconds: number): void;
} {
    let currentTime = 0;
    const sleeps: number[] = [];

    return {
        sleeps,
        now: () => currentTime,
        advance(milliseconds) {
            currentTime += milliseconds;
        },
        async sleep(milliseconds) {
            sleeps.push(milliseconds);
            currentTime += milliseconds;
        },
    };
}
