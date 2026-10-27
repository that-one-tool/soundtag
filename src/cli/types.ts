import type { AudioSources } from "../library/file.js";
import type { CoverMode } from "../tui/cover-mode.js";

export interface ResolvedSources extends AudioSources {
    // Deepest folder holding every source; search terms and log paths start from it.
    root: string;
}

export interface TaggingSettings {
    lastFmApiKey?: string;
    recursive: boolean;
    verbose: boolean;
    overwrite: boolean;
    // Writes one JSON event per line on stdout for programs driving SoundTag.
    json: boolean;
    musicBrainzUserAgent?: string;
    youtubeApiKey?: string;
    listenBrainzToken?: string;
    coverMode?: CoverMode;
    discogsConsumerKey?: string;
    discogsConsumerSecret?: string;
}

export interface AppConfig extends TaggingSettings {
    sources: ResolvedSources;
}

export interface SessionConfig {
    settings: TaggingSettings;
    sourcePaths: string[];
}

export interface CommandLineOptions {
    sourcePaths: string[];
    recursive: boolean;
    verbose: boolean;
    overwrite: boolean;
    json: boolean;
}
