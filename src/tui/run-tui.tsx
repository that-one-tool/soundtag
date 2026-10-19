import { render } from "ink";
import { App } from "./components/app.js";
import {
    createTuiServices,
    type TaggingOptions,
    type TuiServices,
} from "./tui-services.js";
import type { TuiOutcome } from "./types.js";

export interface TuiOptions extends TaggingOptions {
    startDirectory: string;
}

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

export function runTui(
    options: TuiOptions,
    streams: TerminalStreams = processStreams
): Promise<TuiOutcome> {
    return renderTui(
        createTuiServices(options),
        options.startDirectory,
        streams
    );
}
