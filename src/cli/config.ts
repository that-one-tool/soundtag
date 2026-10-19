import * as path from "node:path";
import { parseArguments } from "./cli-options.js";
import { isDirectory } from "../library/file.js";
import type { AppConfig } from "./types.js";

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

async function resolveSourceRoot(
    sourceInput: string,
    workingDirectory: string
): Promise<string> {
    const sourceRoot = path.resolve(workingDirectory, sourceInput);

    if (!(await isDirectory(sourceRoot))) {
        throw new Error("The source folder does not exist.");
    }

    return sourceRoot;
}

function resolveApiKey({ env, ask }: ConfigSources): Promise<string> {
    return resolveRequiredValue(
        env.LASTFM_API_KEY,
        () => ask("Enter your Last.fm API key: "),
        "A Last.fm API key is required."
    );
}

function resolveSourceInput(
    sourcePath: string | undefined,
    ask: Ask
): Promise<string> {
    return resolveRequiredValue(
        sourcePath,
        () => ask("Enter the source folder path: "),
        "A source folder is required."
    );
}

export async function loadConfig(sources: ConfigSources): Promise<AppConfig> {
    const options = parseArguments(sources.argv);
    const lastFmApiKey = await resolveApiKey(sources);
    const sourceInput = await resolveSourceInput(
        options.sourcePath,
        sources.ask
    );

    return {
        lastFmApiKey,
        sourceRoot: await resolveSourceRoot(
            sourceInput,
            sources.workingDirectory
        ),
        recursive: options.recursive,
        verbose: options.verbose,
        musicBrainzUserAgent: sources.env.MUSICBRAINZ_USER_AGENT,
        youtubeApiKey: sources.env.YOUTUBE_API_KEY,
    };
}
