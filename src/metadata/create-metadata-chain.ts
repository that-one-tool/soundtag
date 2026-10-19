import { ItunesProvider } from "./providers/itunes.js";
import { LastFmProvider } from "./providers/lastfm.js";
import { MetadataChain } from "./metadata-chain.js";
import { MusicBrainzProvider } from "./providers/musicbrainz.js";
import { ImageCache } from "../shared/image-cache.js";
import type { Logger } from "../shared/logger.js";
import type { Clock } from "../shared/rate-limiter.js";
import type { MetadataProvider, ProviderServices } from "./types.js";
import { YouTubeCoverProvider } from "./providers/youtube.js";

export interface MetadataChainConfig {
    lastFmApiKey: string;
    verbose: boolean;
    musicBrainzUserAgent?: string;
    youtubeApiKey?: string;
}

function createMusicBrainzProviders(
    userAgent: string | undefined,
    services: ProviderServices
): MetadataProvider[] {
    const trimmedUserAgent = userAgent?.trim();

    if (!trimmedUserAgent) {
        services.logger.error(
            "MusicBrainz fallback requires MUSICBRAINZ_USER_AGENT."
        );
        return [];
    }

    return [new MusicBrainzProvider(trimmedUserAgent, services)];
}

function createCoverProvider(
    apiKey: string | undefined,
    services: ProviderServices
): YouTubeCoverProvider | undefined {
    const trimmedApiKey = apiKey?.trim();
    return trimmedApiKey
        ? new YouTubeCoverProvider(trimmedApiKey, services)
        : undefined;
}

function createProviders(
    config: MetadataChainConfig,
    services: ProviderServices
): MetadataProvider[] {
    return [
        new LastFmProvider(
            { apiKey: config.lastFmApiKey, verbose: config.verbose },
            services
        ),
        ...createMusicBrainzProviders(config.musicBrainzUserAgent, services),
        new ItunesProvider(services),
    ];
}

export function createMetadataChain(
    config: MetadataChainConfig,
    clock: Clock,
    logger: Logger
): MetadataChain {
    const services = { clock, logger, images: new ImageCache() };
    return new MetadataChain(
        createProviders(config, services),
        createCoverProvider(config.youtubeApiKey, services),
        services
    );
}
