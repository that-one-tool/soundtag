import * as fs from "node:fs/promises";
import * as path from "node:path";
import dotenv from "dotenv";
import { getErrorMessage } from "../shared/errors.js";

export interface EnvFileSources {
    workingDirectory: string;
    homeDirectory: string;
    env: NodeJS.ProcessEnv;
    warn(message: string): void;
}

// Other variables are ignored so a project's .env cannot change Node's behaviour.
const SOUNDTAG_KEYS = [
    "LASTFM_API_KEY",
    "MUSICBRAINZ_USER_AGENT",
    "LISTENBRAINZ_TOKEN",
    "YOUTUBE_API_KEY",
    "SOUNDTAG_COVER",
    "DISCOGS_CONSUMER_KEY",
    "DISCOGS_CONSUMER_SECRET",
];
const ABSENT_FILE_CODES = new Set(["ENOENT", "ENOTDIR", "EISDIR"]);

// The XDG spec requires ignoring an empty or relative XDG_CONFIG_HOME.
function getConfigDirectory({ env, homeDirectory }: EnvFileSources): string {
    const configHome = env.XDG_CONFIG_HOME ?? "";
    return path.isAbsolute(configHome)
        ? configHome
        : path.join(homeDirectory, ".config");
}

function getEnvFileCandidates(sources: EnvFileSources): string[] {
    return [
        path.join(sources.workingDirectory, ".env"),
        path.join(getConfigDirectory(sources), "soundtag", ".env"),
    ];
}

function isAbsentFileError(error: unknown): boolean {
    return ABSENT_FILE_CODES.has((error as NodeJS.ErrnoException).code ?? "");
}

async function readEnvFile(
    envFile: string,
    { warn }: EnvFileSources
): Promise<string | null> {
    try {
        return await fs.readFile(envFile, "utf8");
    } catch (error) {
        if (!isAbsentFileError(error)) {
            warn(`Warning: cannot read ${envFile}: ${getErrorMessage(error)}`);
        }

        return null;
    }
}

function applySoundTagKeys(
    parsed: Record<string, string>,
    env: NodeJS.ProcessEnv
): void {
    SOUNDTAG_KEYS.filter(
        (key) => env[key] === undefined && parsed[key] !== undefined
    ).forEach((key) => (env[key] = parsed[key]));
}

// Earlier files win key by key, and the shell environment wins over every file.
export async function loadEnvFiles(sources: EnvFileSources): Promise<string[]> {
    const loadedFiles: string[] = [];

    for (const envFile of getEnvFileCandidates(sources)) {
        const content = await readEnvFile(envFile, sources);

        if (content !== null) {
            applySoundTagKeys(dotenv.parse(content), sources.env);
            loadedFiles.push(envFile);
        }
    }

    return loadedFiles;
}
