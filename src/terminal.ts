import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import type { Ask } from "./config.js";
import { InputCancelledError } from "./errors.js";
import { EXIT_INTERRUPTED } from "./exit-codes.js";

export interface TerminalSession {
    ask: Ask;
    stopSignal: AbortSignal;
    close(): void;
}

function createStopRequester(stopRequested: AbortController): () => void {
    return () => {
        if (stopRequested.signal.aborted) {
            process.exit(EXIT_INTERRUPTED);
        }

        console.log("\nInterrupted. Press Ctrl+C again to quit immediately.");
        stopRequested.abort();
    };
}

function createAsk(
    terminal: readline.Interface,
    cancelSignal: AbortSignal
): Ask {
    return async (question) => {
        try {
            return await terminal.question(question, { signal: cancelSignal });
        } catch (error) {
            throw new InputCancelledError({ cause: error });
        }
    };
}

function listenForStopRequests(
    terminal: readline.Interface,
    stopRequested: AbortController
): () => void {
    const requestStop = createStopRequester(stopRequested);
    terminal.on("SIGINT", requestStop);
    process.on("SIGINT", requestStop);
    return () => process.off("SIGINT", requestStop);
}

export function openTerminalSession(): TerminalSession {
    const terminal = readline.createInterface({ input, output });
    const inputClosed = new AbortController();
    const stopRequested = new AbortController();
    terminal.once("close", () => inputClosed.abort());
    const stopListening = listenForStopRequests(terminal, stopRequested);
    const cancelSignal = AbortSignal.any([
        inputClosed.signal,
        stopRequested.signal,
    ]);

    return {
        ask: createAsk(terminal, cancelSignal),
        stopSignal: stopRequested.signal,
        close: () => {
            stopListening();
            terminal.close();
        },
    };
}
