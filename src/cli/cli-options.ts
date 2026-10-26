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

const enableRenaming: OptionHandler = (options) => {
    options.renameFiles = true;
};

const disableRenaming: OptionHandler = (options) => {
    options.renameFiles = false;
};

const enableTagFixing: OptionHandler = (options) => {
    options.fixTags = true;
};

const OPTION_HANDLERS = new Map<string, OptionHandler>([
    ["--recursive", enableRecursion],
    ["-r", enableRecursion],
    ["--no-recursive", disableRecursion],
    ["--verbose", enableVerboseOutput],
    ["-v", enableVerboseOutput],
    ["--rename", enableRenaming],
    ["--no-rename", disableRenaming],
    ["--fix", enableTagFixing],
]);

function setSourcePath(options: CommandLineOptions, sourcePath: string): void {
    if (options.sourcePath) {
        throw new Error("Only one source folder path can be provided.");
    }

    options.sourcePath = sourcePath;
}

function applyArgument(options: CommandLineOptions, arg: string): void {
    const handleOption = OPTION_HANDLERS.get(arg);

    if (handleOption) {
        return handleOption(options);
    }

    if (arg.startsWith("-")) {
        throw new Error(`Unknown option: ${arg}`);
    }

    setSourcePath(options, arg);
}

export function parseArguments(args: string[]): CommandLineOptions {
    const options: CommandLineOptions = {
        recursive: true,
        verbose: false,
        renameFiles: false,
        fixTags: false,
    };

    for (const arg of args) {
        applyArgument(options, arg);
    }

    return options;
}
