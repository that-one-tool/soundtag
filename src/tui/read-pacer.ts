import { systemClock, type Clock } from "../shared/rate-limiter.js";

// While a key repeats, waits for the cursor to settle so scrolling does not
// read every file's tags.
const SETTLE_DELAY_MILLISECONDS = 80;

export class ReadPacer {
    private lastPath: string | undefined;
    private lastRequestAt = Number.NEGATIVE_INFINITY;

    constructor(private readonly clock: Clock = systemClock) {}

    async wait(path: string): Promise<void> {
        await this.clock.sleep(this.getDelay(path));
    }

    private getDelay(path: string): number {
        if (path === this.lastPath) {
            return 0;
        }

        const now = this.clock.now();
        const elapsed = now - this.lastRequestAt;
        this.lastPath = path;
        this.lastRequestAt = now;
        return elapsed < SETTLE_DELAY_MILLISECONDS
            ? SETTLE_DELAY_MILLISECONDS
            : 0;
    }
}
