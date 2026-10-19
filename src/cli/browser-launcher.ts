import type { TerminalStreams, TuiOptions } from "../tui/run-tui.js";
import type { TuiOutcome } from "../tui/types.js";
import { EXIT_INTERRUPTED } from "./exit-codes.js";

export type BrowserLauncher = (options: TuiOptions) => Promise<TuiOutcome>;

export interface TerminalStreamsState {
    stdin: { isTTY?: boolean };
    stdout: { isTTY?: boolean };
}

export interface BrowserTerminal {
    release(): void;
    exit(code: number): void;
}

// Loaded on demand so scripted runs never load React and Ink.
export async function runTuiLazily(
    options: TuiOptions,
    streams?: TerminalStreams
): Promise<TuiOutcome> {
    const { runTui } = await import("../tui/run-tui.js");
    return runTui(options, streams);
}

export function isInteractiveTerminal({
    stdin,
    stdout,
}: TerminalStreamsState): boolean {
    return Boolean(stdin.isTTY && stdout.isTTY);
}

export function createBrowserLauncher(
    terminal: BrowserTerminal,
    runBrowser: BrowserLauncher
): BrowserLauncher {
    return async (options) => {
        terminal.release();
        const outcome = await runBrowser(options);

        if (outcome === "forced") {
            terminal.exit(EXIT_INTERRUPTED);
        }

        return outcome;
    };
}
