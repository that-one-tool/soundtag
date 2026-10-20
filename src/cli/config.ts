import * as path from "node:path";
import { parseArguments } from "./cli-options.js";
import { isDirectory } from "../library/file.js";
import { parseCoverMode } from "../tui/cover-mode.js";
import type { SessionConfig } from "./types.js";

export type Ask = (question: string) => Promise<string>;

export interface ConfigSources {
    argv: string[];
    env: NodeJS.ProcessEnv;
    ask: Ask;
    workingDirectory: string;
}

async function resolveRequiredValue(
    value: string | undefined,
    askValue: () => Promise<string>,
    missingMessage: string
): Promise<string> {
    const resolved = (value ?? (await askValue())).trim();

    if (!resolved) {
        throw new Error(missingMessage);
    }

    return resolved;
}

function resolveApiKey({ env, ask }: ConfigSources): Promise<string> {
    return resolveRequiredValue(
        env.LASTFM_API_KEY,
        () => ask("Enter your Last.fm API key: "),
        "A Last.fm API key is required."
    );
}

export async function resolveSourceRoot(
    sourceInput: string,
    workingDirectory: string
): Promise<string> {
    const trimmedInput = sourceInput.trim();

    if (!trimmedInput) {
        throw new Error("A source folder is required.");
    }

    const sourceRoot = path.resolve(workingDirectory, trimmedInput);

    if (!(await isDirectory(sourceRoot))) {
        throw new Error("The source folder does not exist.");
    }

    return sourceRoot;
}

export async function loadSessionConfig(
    sources: ConfigSources
): Promise<SessionConfig> {
    const options = parseArguments(sources.argv);

    return {
        sourcePath: options.sourcePath,
        settings: {
            lastFmApiKey: await resolveApiKey(sources),
            recursive: options.recursive,
            verbose: options.verbose,
            renameFiles: options.renameFiles,
            musicBrainzUserAgent: sources.env.MUSICBRAINZ_USER_AGENT,
            youtubeApiKey: sources.env.YOUTUBE_API_KEY,
            coverMode: parseCoverMode(sources.env.SOUNDTAG_COVER),
        },
    };
}
