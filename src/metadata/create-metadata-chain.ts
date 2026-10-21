import { DeezerClient } from "./providers/deezer-client.js";
import { DeezerCoverProvider } from "./providers/deezer-cover.js";
import { DeezerProvider } from "./providers/deezer.js";
import { ItunesProvider } from "./providers/itunes.js";
import { LastFmProvider } from "./providers/lastfm.js";
import { ListenBrainzClient } from "./providers/listenbrainz-client.js";
import { ListenBrainzProvider } from "./providers/listenbrainz.js";
import { trimOrEmpty } from "./track-metadata.js";
import { MetadataChain } from "./metadata-chain.js";
import { MusicBrainzClient } from "./providers/musicbrainz-client.js";
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
    verbose: boolean;
    lastFmApiKey?: string;
    musicBrainzUserAgent?: string;
    listenBrainzToken?: string;
    youtubeApiKey?: string;
}

interface ProviderKeys {
    lastFmApiKey: string;
    musicBrainzUserAgent: string;
    listenBrainzToken: string;
}

interface MissingKeyWarning {
    isMissing(keys: ProviderKeys): boolean;
    level: "error" | "info";
    message: string;
}

const MISSING_KEY_WARNINGS: MissingKeyWarning[] = [
    {
        isMissing: (keys) => !keys.musicBrainzUserAgent,
        level: "error",
        message: "MusicBrainz and ListenBrainz require MUSICBRAINZ_USER_AGENT.",
    },
    {
        isMissing: (keys) => !keys.listenBrainzToken,
        level: "info",
        message: "ListenBrainz lookup requires LISTENBRAINZ_TOKEN.",
    },
    {
        isMissing: (keys) => !keys.lastFmApiKey,
        level: "info",
        message: "Last.fm lookup requires LASTFM_API_KEY.",
    },
];

function getProviderKeys(config: MetadataChainConfig): ProviderKeys {
    return {
        lastFmApiKey: trimOrEmpty(config.lastFmApiKey),
        musicBrainzUserAgent: trimOrEmpty(config.musicBrainzUserAgent),
        listenBrainzToken: trimOrEmpty(config.listenBrainzToken),
    };
}

function warnAboutMissingKeys(keys: ProviderKeys, logger: Logger): void {
    MISSING_KEY_WARNINGS.filter((warning) => warning.isMissing(keys)).forEach(
        (warning) => logger[warning.level](warning.message)
    );
}

function createListenBrainzProviders(
    keys: ProviderKeys,
    musicBrainz: MusicBrainzClient,
    services: ProviderServices
): MetadataProvider[] {
    const { listenBrainzToken: token, musicBrainzUserAgent: userAgent } = keys;

    if (!token || !userAgent) {
        return [];
    }

    const listenBrainz = new ListenBrainzClient({ token, userAgent }, services);
    return [new ListenBrainzProvider(listenBrainz, musicBrainz, services)];
}

function createMusicBrainzProviders(
    keys: ProviderKeys,
    musicBrainz: MusicBrainzClient,
    services: ProviderServices
): MetadataProvider[] {
    return keys.musicBrainzUserAgent
        ? [new MusicBrainzProvider(musicBrainz, services)]
        : [];
}

function createLastFmProviders(
    keys: ProviderKeys,
    config: MetadataChainConfig,
    services: ProviderServices
): MetadataProvider[] {
    const settings = { apiKey: keys.lastFmApiKey, verbose: config.verbose };
    return keys.lastFmApiKey ? [new LastFmProvider(settings, services)] : [];
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

// MusicBrainz searches and ListenBrainz release lookups share one rate limit.
function createProviders(
    config: MetadataChainConfig,
    deezer: DeezerClient,
    services: ProviderServices
): MetadataProvider[] {
    const keys = getProviderKeys(config);
    warnAboutMissingKeys(keys, services.logger);
    const musicBrainz = new MusicBrainzClient(
        keys.musicBrainzUserAgent,
        services
    );
    return [
        ...createListenBrainzProviders(keys, musicBrainz, services),
        ...createMusicBrainzProviders(keys, musicBrainz, services),
        new DeezerProvider(deezer, services),
        new ItunesProvider(services),
        ...createLastFmProviders(keys, config, services),
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
