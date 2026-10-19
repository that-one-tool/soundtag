import { Listeners } from "./listeners.js";
import type { QueueState, TagJobRunner, TagTarget } from "./types.js";

export class TaggingQueue {
    private readonly listeners = new Listeners();
    private state: QueueState = {
        running: null,
        pending: [],
        stopping: false,
        failed: false,
    };
    private controller = new AbortController();
    private idle: Promise<void> = Promise.resolve();

    constructor(private readonly runJob: TagJobRunner) {}

    subscribe = (listener: () => void): (() => void) =>
        this.listeners.add(listener);

    getSnapshot = (): QueueState => this.state;

    whenIdle(): Promise<void> {
        return this.idle;
    }

    enqueue(target: TagTarget): void {
        if (this.isQueued(target)) {
            return;
        }

        this.update({ pending: [...this.state.pending, target] });

        if (!this.state.running) {
            this.idle = this.drain();
        }
    }

    stop(): void {
        if (!this.state.running) {
            return;
        }

        this.controller.abort();
        this.update({ pending: [], stopping: true });
    }

    private isQueued({ path }: TagTarget): boolean {
        const { running, pending } = this.state;
        return [running, ...pending].some((queued) => queued?.path === path);
    }

    private async drain(): Promise<void> {
        for (let next = this.takeNext(); next; next = this.takeNext()) {
            await this.runTarget(next);
        }
    }

    private takeNext(): TagTarget | undefined {
        const [next, ...pending] = this.state.pending;
        this.update({ running: next ?? null, pending, stopping: false });
        return next;
    }

    private async runTarget(target: TagTarget): Promise<void> {
        this.controller = new AbortController();
        const succeeded = await this.runJob(
            target,
            this.controller.signal
        ).catch(() => false);

        if (!succeeded) {
            this.update({ failed: true });
        }
    }

    private update(changes: Partial<QueueState>): void {
        this.state = { ...this.state, ...changes };
        this.listeners.notify();
    }
}
