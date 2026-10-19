import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import type { Ask } from "./config.js";
import { InputCancelledError } from "../shared/errors.js";
import { EXIT_INTERRUPTED } from "./exit-codes.js";

export interface TerminalSession {
    ask: Ask;
    renewStopSignal(): AbortSignal;
    close(): void;
}

interface TerminalStreams {
    input: NodeJS.ReadableStream;
    output: NodeJS.WritableStream;
}

interface StopRequest {
    controller: AbortController;
    prompting: boolean;
}

function getStopMessage({ prompting }: StopRequest): string {
    return prompting
        ? "\nInterrupted."
        : "\nInterrupted. Press Ctrl+C again to quit immediately.";
}

function createStopRequester(stopRequest: StopRequest): () => void {
    return () => {
        if (stopRequest.controller.signal.aborted) {
            process.exit(EXIT_INTERRUPTED);
        }

        console.log(getStopMessage(stopRequest));
        stopRequest.controller.abort();
    };
}

function createAsk(
    terminal: readline.Interface,
    inputClosed: AbortSignal,
    stopRequest: StopRequest
): Ask {
    return async (question) => {
        const cancelSignal = AbortSignal.any([
            inputClosed,
            stopRequest.controller.signal,
        ]);

        stopRequest.prompting = true;

        try {
            return await terminal.question(question, { signal: cancelSignal });
        } catch (error) {
            throw new InputCancelledError({ cause: error });
        } finally {
            stopRequest.prompting = false;
        }
    };
}

function renewStopSignal(stopRequest: StopRequest): AbortSignal {
    stopRequest.controller = new AbortController();
    return stopRequest.controller.signal;
}

function listenForStopRequests(
    terminal: readline.Interface,
    stopRequest: StopRequest
): () => void {
    const requestStop = createStopRequester(stopRequest);
    terminal.on("SIGINT", requestStop);
    process.on("SIGINT", requestStop);
    return () => process.off("SIGINT", requestStop);
}

export function openTerminalSession(
    streams: TerminalStreams = { input, output }
): TerminalSession {
    const terminal = readline.createInterface(streams);
    const inputClosed = new AbortController();
    const stopRequest: StopRequest = {
        controller: new AbortController(),
        prompting: false,
    };
    terminal.once("close", () => inputClosed.abort());
    const stopListening = listenForStopRequests(terminal, stopRequest);

    return {
        ask: createAsk(terminal, inputClosed.signal, stopRequest),
        renewStopSignal: () => renewStopSignal(stopRequest),
        close: () => {
            stopListening();
            terminal.close();
        },
    };
}
