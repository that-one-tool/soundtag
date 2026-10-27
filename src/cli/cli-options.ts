import type { CommandLineOptions } from "./types.js";

type OptionHandler = (options: CommandLineOptions) => void;

const enableRecursion: OptionHandler = (options) => {
    options.recursive = true;
};

const disableRecursion: OptionHandler = (options) => {
    options.recursive = false;
};

const enableVerboseOutput: OptionHandler = (options) => {
    options.verbose = true;
};

const enableOverwriting: OptionHandler = (options) => {
    options.overwrite = true;
};

const enableJsonEvents: OptionHandler = (options) => {
    options.json = true;
};

const OPTION_HANDLERS = new Map<string, OptionHandler>([
    ["--recursive", enableRecursion],
    ["-r", enableRecursion],
    ["--no-recursive", disableRecursion],
    ["--verbose", enableVerboseOutput],
    ["-v", enableVerboseOutput],
    ["--overwrite", enableOverwriting],
    ["--json", enableJsonEvents],
]);

function applyArgument(options: CommandLineOptions, arg: string): void {
    const handleOption = OPTION_HANDLERS.get(arg);

    if (handleOption) {
        return handleOption(options);
    }

    if (arg.startsWith("-")) {
        throw new Error(`Unknown option: ${arg}`);
    }

    options.sourcePaths.push(arg);
}

export function parseArguments(args: string[]): CommandLineOptions {
    const options: CommandLineOptions = {
        sourcePaths: [],
        recursive: true,
        verbose: false,
        overwrite: false,
        json: false,
    };

    for (const arg of args) {
        applyArgument(options, arg);
    }

    return options;
}
