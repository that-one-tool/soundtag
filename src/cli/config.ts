import * as path from "node:path";
import { parseArguments } from "./cli-options.js";
import { isDirectory } from "../library/file.js";
import { parseCoverMode } from "../tui/cover-mode.js";
import type { SessionConfig } from "./types.js";

export interface ConfigSources {
    argv: string[];
    env: NodeJS.ProcessEnv;
    workingDirectory: string;
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

export function loadSessionConfig(sources: ConfigSources): SessionConfig {
    const options = parseArguments(sources.argv);

    return {
        sourcePath: options.sourcePath,
        settings: {
            lastFmApiKey: sources.env.LASTFM_API_KEY,
            recursive: options.recursive,
            verbose: options.verbose,
            renameFiles: options.renameFiles,
            musicBrainzUserAgent: sources.env.MUSICBRAINZ_USER_AGENT,
            youtubeApiKey: sources.env.YOUTUBE_API_KEY,
            listenBrainzToken: sources.env.LISTENBRAINZ_TOKEN,
            coverMode: parseCoverMode(sources.env.SOUNDTAG_COVER),
        },
    };
}
