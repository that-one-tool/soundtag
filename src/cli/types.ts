import type { CoverMode } from "../tui/cover-mode.js";

export interface TaggingSettings {
    lastFmApiKey?: string;
    recursive: boolean;
    verbose: boolean;
    musicBrainzUserAgent?: string;
    youtubeApiKey?: string;
    listenBrainzToken?: string;
    coverMode?: CoverMode;
    discogsConsumerKey?: string;
    discogsConsumerSecret?: string;
}

export interface AppConfig extends TaggingSettings {
    sourceRoot: string;
}

export interface SessionConfig {
    settings: TaggingSettings;
    sourcePath?: string;
}

export interface CommandLineOptions {
    sourcePath?: string;
    recursive: boolean;
    verbose: boolean;
}
