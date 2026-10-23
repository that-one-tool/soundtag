import { render } from "ink";
import {
    DEFAULT_CELL_RATIO,
    queryCellRatio,
    type CellQueryStreams,
} from "./cell-shape.js";
import { detectCoverMode, type CoverMode } from "./cover-mode.js";
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

async function getCellRatio(mode: CoverMode, streams: CellQueryStreams) {
    return mode === "kitty" ? queryCellRatio(streams) : DEFAULT_CELL_RATIO;
}

export async function createCoverDisplay(
    options: TuiOptions,
    streams: CellQueryStreams,
    env: NodeJS.ProcessEnv
): Promise<CoverDisplay> {
    const trueColor = hasTrueColor(streams.stdout);
    const override = options.coverMode;
    const mode = detectCoverMode({ env, trueColor, override });
    return {
        mode,
        cellRatio: await getCellRatio(mode, streams),
        writeToTerminal: (text) => streams.stdout.write(text),
    };
}

export async function runTui(
    options: TuiOptions,
    streams: TerminalStreams = processStreams,
    env: NodeJS.ProcessEnv = process.env
): Promise<TuiOutcome> {
    const display = await createCoverDisplay(options, streams, env);
    return renderTui(
        createTuiServices(options, display),
        options.startDirectory,
        streams
    );
}
