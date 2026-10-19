import { ItunesProvider } from "./providers/itunes.js";
import { LastFmProvider } from "./providers/lastfm.js";
import { MetadataChain } from "./metadata-chain.js";
import { MusicBrainzProvider } from "./providers/musicbrainz.js";
import { systemClock, type Clock } from "../shared/rate-limiter.js";
import type { MetadataProvider } from "./types.js";
import { YouTubeCoverProvider } from "./providers/youtube.js";

export interface MetadataChainConfig {
    lastFmApiKey: string;
    verbose: boolean;
    musicBrainzUserAgent?: string;
    youtubeApiKey?: string;
}

function createMusicBrainzProviders(
    userAgent: string | undefined,
    clock: Clock
): MetadataProvider[] {
    const trimmedUserAgent = userAgent?.trim();

    if (!trimmedUserAgent) {
        console.error("MusicBrainz fallback requires MUSICBRAINZ_USER_AGENT.");
        return [];
    }

    return [new MusicBrainzProvider(trimmedUserAgent, clock)];
}

function createCoverProvider(
    apiKey: string | undefined
): YouTubeCoverProvider | undefined {
    const trimmedApiKey = apiKey?.trim();
    return trimmedApiKey ? new YouTubeCoverProvider(trimmedApiKey) : undefined;
}

export function createMetadataChain(
    config: MetadataChainConfig,
    clock: Clock = systemClock
): MetadataChain {
    const providers = [
        new LastFmProvider(config.lastFmApiKey, config.verbose),
        ...createMusicBrainzProviders(config.musicBrainzUserAgent, clock),
        new ItunesProvider(clock),
    ];

    return new MetadataChain(
        providers,
        createCoverProvider(config.youtubeApiKey)
    );
}
