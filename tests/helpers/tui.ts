import { LogBuffer } from "../../src/tui/log-buffer.js";
import { TaggingQueue } from "../../src/tui/tagging-queue.js";
import { TrackStatusStore } from "../../src/tui/track-status-store.js";
import type { TuiServices } from "../../src/tui/tui-services.js";
import type { TagTarget } from "../../src/tui/types.js";

export interface ControlledJob {
    target: TagTarget;
    stopSignal: AbortSignal;
    finish(succeeded: boolean): void;
}

export function createControlledServices(): {
    services: TuiServices;
    jobs: ControlledJob[];
} {
    const jobs: ControlledJob[] = [];
    const queue = new TaggingQueue(
        (target, stopSignal) =>
            new Promise<boolean>((resolve) =>
                jobs.push({ target, stopSignal, finish: resolve })
            )
    );
    return {
        services: {
            queue,
            logBuffer: new LogBuffer(),
            statusStore: new TrackStatusStore(),
        },
        jobs,
    };
}
