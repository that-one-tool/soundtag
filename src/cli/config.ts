import * as path from "node:path";
import { parseArguments } from "./cli-options.js";
import {
    getAudioFormat,
    isDirectory,
    isFile,
    type AudioSources,
} from "../library/file.js";
import { getFileRoot } from "../library/album-plan.js";
import { findCommonFolder, isInsideFolder } from "../shared/paths.js";
import { parseCoverMode } from "../tui/cover-mode.js";
import type { ResolvedSources, SessionConfig } from "./types.js";

export interface ConfigSources {
    argv: string[];
    env: NodeJS.ProcessEnv;
    workingDirectory: string;
}

function resolveInput(input: string, workingDirectory: string): string {
    const trimmedInput = input.trim();

    if (!trimmedInput) {
        throw new Error("A source folder is required.");
    }

    return path.resolve(workingDirectory, trimmedInput);
}

async function checkAudioFile(file: string, input: string): Promise<void> {
    if (!(await isFile(file))) {
        throw new Error(`Source not found: ${input.trim()}`);
    }

    if (!getAudioFormat(file)) {
        throw new Error(`Not a supported audio file: ${input.trim()}`);
    }
}

async function addSource(
    sources: AudioSources,
    input: string,
    workingDirectory: string
): Promise<void> {
    const source = resolveInput(input, workingDirectory);

    if (await isDirectory(source)) {
        sources.folders.push(source);
        return;
    }

    await checkAudioFile(source, input);
    sources.files.push(source);
}

export async function resolveSources(
    inputs: string[],
    workingDirectory: string
): Promise<ResolvedSources> {
    const sources: AudioSources = { folders: [], files: [] };

    for (const input of inputs) {
        await addSource(sources, input, workingDirectory);
    }

    const folders = [...sources.folders, ...sources.files.map(path.dirname)];
    return { root: findCommonFolder(folders), ...sources };
}

export function findSearchRoot(
    { folders }: AudioSources,
    file: string
): string {
    const containing = folders.filter((source) => isInsideFolder(file, source));
    const deepest = containing.toSorted(
        (first, second) => second.length - first.length
    );
    return deepest[0] ?? getFileRoot(file);
}

export function loadSessionConfig(sources: ConfigSources): SessionConfig {
    const { sourcePaths, ...options } = parseArguments(sources.argv);

    return {
        sourcePaths,
        settings: {
            lastFmApiKey: sources.env.LASTFM_API_KEY,
            ...options,
            musicBrainzUserAgent: sources.env.MUSICBRAINZ_USER_AGENT,
            youtubeApiKey: sources.env.YOUTUBE_API_KEY,
            listenBrainzToken: sources.env.LISTENBRAINZ_TOKEN,
            coverMode: parseCoverMode(sources.env.SOUNDTAG_COVER),
            discogsConsumerKey: sources.env.DISCOGS_CONSUMER_KEY,
            discogsConsumerSecret: sources.env.DISCOGS_CONSUMER_SECRET,
        },
    };
}
