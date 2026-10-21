import { systemClock, type Clock } from "../shared/rate-limiter.js";
import { EXIT_INTERRUPTED } from "./exit-codes.js";

// npm forwards the terminal's SIGINT to its child, so one key press arrives twice.
const REPEAT_WINDOW = 200;

export interface StopSession {
    renewStopSignal(): AbortSignal;
    close(): void;
}

interface StopRequest {
    controller: AbortController;
    requestedAt: number;
}

function isRepeat(stopRequest: StopRequest, now: number): boolean {
    return now - stopRequest.requestedAt < REPEAT_WINDOW;
}

function requestStop(stopRequest: StopRequest, now: number): void {
    if (stopRequest.controller.signal.aborted) {
        process.exit(EXIT_INTERRUPTED);
    }

    console.log("\nInterrupted. Press Ctrl+C again to quit immediately.");
    stopRequest.controller.abort();
    stopRequest.requestedAt = now;
}

function createStopRequester(
    stopRequest: StopRequest,
    clock: Clock
): () => void {
    return () => {
        const now = clock.now();

        if (!isRepeat(stopRequest, now)) {
            requestStop(stopRequest, now);
        }
    };
}

function renewStopSignal(stopRequest: StopRequest): AbortSignal {
    stopRequest.controller = new AbortController();
    return stopRequest.controller.signal;
}

export function openStopSession(clock: Clock = systemClock): StopSession {
    const stopRequest: StopRequest = {
        controller: new AbortController(),
        requestedAt: Number.NEGATIVE_INFINITY,
    };
    const onSigint = createStopRequester(stopRequest, clock);
    process.on("SIGINT", onSigint);

    return {
        renewStopSignal: () => renewStopSignal(stopRequest),
        close: () => process.off("SIGINT", onSigint),
    };
}
