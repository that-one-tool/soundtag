import { ItunesProvider } from "./providers/itunes.js";
import { LastFmProvider } from "./providers/lastfm.js";
import { MetadataChain } from "./metadata-chain.js";
import { MusicBrainzProvider } from "./providers/musicbrainz.js";
import type { Logger } from "../shared/logger.js";
import type { Clock } from "../shared/rate-limiter.js";
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
    clock: Clock,
    logger: Logger
): MetadataProvider[] {
    const trimmedUserAgent = userAgent?.trim();

    if (!trimmedUserAgent) {
        logger.error("MusicBrainz fallback requires MUSICBRAINZ_USER_AGENT.");
        return [];
    }

    return [new MusicBrainzProvider(trimmedUserAgent, clock, logger)];
}

function createCoverProvider(
    apiKey: string | undefined,
    logger: Logger
): YouTubeCoverProvider | undefined {
    const trimmedApiKey = apiKey?.trim();
    return trimmedApiKey
        ? new YouTubeCoverProvider(trimmedApiKey, logger)
        : undefined;
}

function createProviders(
    config: MetadataChainConfig,
    clock: Clock,
    logger: Logger
): MetadataProvider[] {
    return [
        new LastFmProvider(
            { apiKey: config.lastFmApiKey, verbose: config.verbose },
            clock,
            logger
        ),
        ...createMusicBrainzProviders(
            config.musicBrainzUserAgent,
            clock,
            logger
        ),
        new ItunesProvider(clock, logger),
    ];
}

export function createMetadataChain(
    config: MetadataChainConfig,
    clock: Clock,
    logger: Logger
): MetadataChain {
    return new MetadataChain(
        createProviders(config, clock, logger),
        createCoverProvider(config.youtubeApiKey, logger),
        logger
    );
}
