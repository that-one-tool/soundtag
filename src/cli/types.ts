export interface TaggingSettings {
    lastFmApiKey: string;
    recursive: boolean;
    verbose: boolean;
    renameFiles: boolean;
    musicBrainzUserAgent?: string;
    youtubeApiKey?: string;
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
    renameFiles: boolean;
}
