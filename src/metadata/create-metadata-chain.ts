import { DeezerClient } from "./providers/deezer-client.js";
import { DeezerCoverProvider } from "./providers/deezer-cover.js";
import { DeezerProvider } from "./providers/deezer.js";
import { ItunesProvider } from "./providers/itunes.js";
import { LastFmProvider } from "./providers/lastfm.js";
import { MetadataChain } from "./metadata-chain.js";
import { MusicBrainzProvider } from "./providers/musicbrainz.js";
import { BatchCache } from "../shared/batch-cache.js";
import { ImageCache } from "../shared/image-cache.js";
import type { Logger } from "../shared/logger.js";
import type { Clock } from "../shared/rate-limiter.js";
import type {
    CoverProvider,
    MetadataProvider,
    ProviderServices,
} from "./types.js";
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

function createYouTubeCoverProviders(
    apiKey: string | undefined,
    services: ProviderServices
): CoverProvider[] {
    const trimmedApiKey = apiKey?.trim();
    return trimmedApiKey
        ? [new YouTubeCoverProvider(trimmedApiKey, services)]
        : [];
}

function createProviders(
    config: MetadataChainConfig,
    deezer: DeezerClient,
    services: ProviderServices
): MetadataProvider[] {
    return [
        new LastFmProvider(
            { apiKey: config.lastFmApiKey, verbose: config.verbose },
            services
        ),
        ...createMusicBrainzProviders(config.musicBrainzUserAgent, services),
        new DeezerProvider(deezer, services),
        new ItunesProvider(services),
    ];
}

function createCoverProviders(
    config: MetadataChainConfig,
    deezer: DeezerClient,
    services: ProviderServices
): CoverProvider[] {
    return [
        new DeezerCoverProvider(deezer, services),
        ...createYouTubeCoverProviders(config.youtubeApiKey, services),
    ];
}

export function createMetadataChain(
    config: MetadataChainConfig,
    clock: Clock,
    logger: Logger
): MetadataChain {
    const services = {
        clock,
        logger,
        images: new ImageCache(),
        cache: new BatchCache(),
    };
    const deezer = new DeezerClient(services);
    return new MetadataChain(
        createProviders(config, deezer, services),
        createCoverProviders(config, deezer, services),
        services
    );
}
