import { Console } from "node:console";
import type {
    ProcessedTrack,
    ProcessingStats,
    TrackStatus,
} from "../processing/types.js";

export interface RunEvents {
    start(total: number): void;
    file(track: ProcessedTrack): void;
    summary(stats: ProcessingStats, run: { stopped: boolean }): void;
    error(message: string): void;
}

export type OutputWriter = (text: string) => void;

const STATUS_NAMES: Record<TrackStatus, string> = {
    TAGGED: "tagged",
    SKIPPED: "skipped",
    FAILED: "failed",
};

class JsonEvents implements RunEvents {
    constructor(private readonly write: OutputWriter) {}

    start(total: number): void {
        this.writeEvent({ type: "start", total });
    }

    file({ source, status }: ProcessedTrack): void {
        this.writeEvent({
            type: "file",
            path: source,
            status: STATUS_NAMES[status],
        });
    }

    summary(stats: ProcessingStats, { stopped }: { stopped: boolean }): void {
        this.writeEvent({
            type: "summary",
            tagged: stats.ok,
            skipped: stats.skipped,
            failed: stats.errors,
            unprocessed: stats.unprocessed,
            stopped,
        });
    }

    error(message: string): void {
        this.writeEvent({ type: "error", message });
    }

    private writeEvent(event: object): void {
        this.write(`${JSON.stringify(event)}\n`);
    }
}

export function createJsonEvents(write: OutputWriter): RunEvents {
    return new JsonEvents(write);
}

const ignoreEvent = (): void => {};

export const silentEvents: RunEvents = {
    start: ignoreEvent,
    file: ignoreEvent,
    summary: ignoreEvent,
    error: ignoreEvent,
};

export function isJsonRequested(argv: string[]): boolean {
    return argv.includes("--json");
}

// JSON mode keeps stdout for events, so every human line goes to stderr.
export function routeConsoleToStderr(): void {
    globalThis.console = new Console(process.stderr, process.stderr);
}
