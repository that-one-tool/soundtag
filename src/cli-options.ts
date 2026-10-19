import type { CommandLineOptions } from "./types.js";

export function parseArguments(args: string[]): CommandLineOptions {
    const options: CommandLineOptions = { recursive: true, verbose: false };

    for (const arg of args) {
        if (arg === "--recursive" || arg === "-r") {
            options.recursive = true;
        } else if (arg === "--no-recursive") {
            options.recursive = false;
        } else if (arg === "--verbose" || arg === "-v") {
            options.verbose = true;
        } else if (arg.startsWith("-")) {
            throw new Error(`Unknown option: ${arg}`);
        } else if (options.sourcePath) {
            throw new Error("Only one source folder path can be provided.");
        } else {
            options.sourcePath = arg;
        }
    }

    return options;
}
