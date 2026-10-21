import { dirname } from "node:path";
import type { Logger } from "../shared/logger.js";
import { isInsideFolder, movePath, type PathMove } from "../shared/paths.js";
import { Listeners } from "./listeners.js";
import { describeTarget } from "./queue-summary.js";
import type { QueueState, TagJobRunner, TagTarget } from "./types.js";

function moveTarget(target: TagTarget, move: PathMove): TagTarget {
    return { ...target, path: movePath(target.path, move) };
}

// A file job may also rename its folder once done, which moves its siblings.
const OCCUPIED_PATHS: Record<TagTarget["kind"], (target: string) => string> = {
    file: (target) => dirname(target),
    folder: (target) => target,
};

function getOccupiedPath({ kind, path: target }: TagTarget): string {
    return OCCUPIED_PATHS[kind](target);
}

function areNested(first: string, second: string): boolean {
    return isInsideFolder(first, second) || isInsideFolder(second, first);
}

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

    constructor(
        private readonly runJob: TagJobRunner,
        private readonly logger: Logger
    ) {}

    subscribe = (listener: () => void): (() => void) =>
        this.listeners.add(listener);

    getSnapshot = (): QueueState => this.state;

    whenIdle(): Promise<void> {
        return this.idle;
    }

    enqueue(target: TagTarget): void {
        const queued = this.findQueued(target);

        if (queued) {
            this.logger.info(`Already queued: ${describeTarget(queued)}.`);
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

    moveTargets(move: PathMove): void {
        const { running, pending } = this.state;
        this.update({
            running: running && moveTarget(running, move),
            pending: pending.map((target) => moveTarget(target, move)),
        });
    }

    isBusyWith(entryPath: string): boolean {
        const { running, pending } = this.state;
        return [running, ...pending].some((target) =>
            Boolean(target && areNested(getOccupiedPath(target), entryPath))
        );
    }

    private findQueued({ path }: TagTarget): TagTarget | null | undefined {
        const { running, pending } = this.state;
        return [running, ...pending].find((queued) => queued?.path === path);
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
