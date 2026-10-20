import { render } from "ink";
import { detectCoverMode } from "./cover-mode.js";
import { App } from "./components/app.js";
import {
    createTuiServices,
    type CoverDisplay,
    type TaggingOptions,
    type TuiServices,
} from "./tui-services.js";
import type { TuiOutcome } from "./types.js";

export type TuiOptions = TaggingOptions;

export interface TerminalStreams {
    stdin: NodeJS.ReadStream;
    stdout: NodeJS.WriteStream;
    stderr: NodeJS.WriteStream;
}

const processStreams: TerminalStreams = {
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
};

export function hasTrueColor(stdout: NodeJS.WriteStream): boolean {
    return stdout.getColorDepth?.() === 24;
}

export async function renderTui(
    services: TuiServices,
    startDirectory: string,
    streams: TerminalStreams
): Promise<TuiOutcome> {
    const instance = render(
        <App startDirectory={startDirectory} services={services} />,
        {
            ...streams,
            alternateScreen: true,
            exitOnCtrlC: false,
            // Ink would otherwise draw only the final frame when CI is set.
            interactive: true,
        }
    );
    return (await instance.waitUntilExit()) as TuiOutcome;
}

export function createCoverDisplay(
    options: TuiOptions,
    stdout: NodeJS.WriteStream,
    env: NodeJS.ProcessEnv
): CoverDisplay {
    const trueColor = hasTrueColor(stdout);
    return {
        mode: detectCoverMode({ env, trueColor, override: options.coverMode }),
        writeToTerminal: (text) => stdout.write(text),
    };
}

export function runTui(
    options: TuiOptions,
    streams: TerminalStreams = processStreams,
    env: NodeJS.ProcessEnv = process.env
): Promise<TuiOutcome> {
    return renderTui(
        createTuiServices(
            options,
            createCoverDisplay(options, streams.stdout, env)
        ),
        options.startDirectory,
        streams
    );
}
