export interface AppConfig {
    lastFmApiKey: string;
    sourceRoot: string;
    recursive: boolean;
    verbose: boolean;
    musicBrainzUserAgent?: string;
    youtubeApiKey?: string;
}

export interface CommandLineOptions {
    sourcePath?: string;
    recursive: boolean;
    verbose: boolean;
}
