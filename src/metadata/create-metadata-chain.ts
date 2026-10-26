import { DeezerClient } from "./providers/deezer-client.js";
import { DeezerCoverProvider } from "./providers/deezer-cover.js";
import { DeezerProvider } from "./providers/deezer.js";
import { DiscogsClient } from "./providers/discogs-client.js";
import {
    DiscogsAlbumProvider,
    DiscogsProvider,
    DiscogsTrackFinder,
} from "./providers/discogs.js";
import { ItunesProvider } from "./providers/itunes.js";
import { LastFmProvider } from "./providers/lastfm.js";
import { ListenBrainzClient } from "./providers/listenbrainz-client.js";
import { ListenBrainzProvider } from "./providers/listenbrainz.js";
import { trimOrEmpty } from "./track-metadata.js";
import { MetadataChain } from "./metadata-chain.js";
import { TrackCorrector } from "./track-corrector.js";
import { MusicBrainzClient } from "./providers/musicbrainz-client.js";
import { MusicBrainzProvider } from "./providers/musicbrainz.js";
import { BatchCache } from "../shared/batch-cache.js";
import { ImageCache } from "../shared/image-cache.js";
import type { Logger } from "../shared/logger.js";
import { LookupLog } from "../shared/lookup-log.js";
import type { Clock } from "../shared/rate-limiter.js";
import type {
    CanonicalSource,
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
    discogsConsumerKey?: string;
    discogsConsumerSecret?: string;
}

export interface MetadataLookups {
    chain: MetadataChain;
    corrector: TrackCorrector;
}

type BrainzProvider = MetadataProvider & CanonicalSource;

interface ProviderKeys {
    lastFmApiKey: string;
    musicBrainzUserAgent: string;
    listenBrainzToken: string;
    discogsConsumerKey: string;
    discogsConsumerSecret: string;
}

interface DiscogsProviders {
    album: MetadataProvider[];
    song: MetadataProvider[];
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
    {
        isMissing: (keys) => !hasDiscogsKeys(keys),
        level: "info",
        message:
            "Discogs lookup requires DISCOGS_CONSUMER_KEY and DISCOGS_CONSUMER_SECRET.",
    },
];

function hasDiscogsKeys(keys: ProviderKeys): boolean {
    return Boolean(keys.discogsConsumerKey && keys.discogsConsumerSecret);
}

function getProviderKeys(config: MetadataChainConfig): ProviderKeys {
    return {
        lastFmApiKey: trimOrEmpty(config.lastFmApiKey),
        musicBrainzUserAgent: trimOrEmpty(config.musicBrainzUserAgent),
        listenBrainzToken: trimOrEmpty(config.listenBrainzToken),
        discogsConsumerKey: trimOrEmpty(config.discogsConsumerKey),
        discogsConsumerSecret: trimOrEmpty(config.discogsConsumerSecret),
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
): BrainzProvider[] {
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
): BrainzProvider[] {
    return keys.musicBrainzUserAgent
        ? [new MusicBrainzProvider(musicBrainz, services)]
        : [];
}

function createLastFmProviders(
    keys: ProviderKeys,
    services: ProviderServices
): MetadataProvider[] {
    const settings = { apiKey: keys.lastFmApiKey };
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
function createBrainzProviders(
    keys: ProviderKeys,
    services: ProviderServices
): BrainzProvider[] {
    const musicBrainz = new MusicBrainzClient(
        keys.musicBrainzUserAgent,
        services
    );
    return [
        ...createListenBrainzProviders(keys, musicBrainz, services),
        ...createMusicBrainzProviders(keys, musicBrainz, services),
    ];
}

// One client, so both share the rate limit and the cached albums.
function createDiscogsProviders(
    keys: ProviderKeys,
    services: ProviderServices
): DiscogsProviders {
    if (!hasDiscogsKeys(keys)) {
        return { album: [], song: [] };
    }

    const credentials = {
        key: keys.discogsConsumerKey,
        secret: keys.discogsConsumerSecret,
    };
    const client = new DiscogsClient(credentials, services);
    const finder = new DiscogsTrackFinder(client, services);
    return {
        album: [new DiscogsAlbumProvider(finder)],
        song: [new DiscogsProvider(finder)],
    };
}

function createOtherProviders(
    keys: ProviderKeys,
    services: ProviderServices
): MetadataProvider[] {
    return [
        new ItunesProvider(services),
        ...createLastFmProviders(keys, services),
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

function createServices(
    verbose: boolean,
    clock: Clock,
    logger: Logger
): ProviderServices {
    return {
        clock,
        logger,
        images: new ImageCache(),
        cache: new BatchCache(),
        lookups: new LookupLog({ logger, clock, verbose }),
    };
}

interface ChainProviders {
    brainz: BrainzProvider[];
    deezer: DeezerProvider;
}

// Discogs checks the album first, and searches songs with no album after Deezer.
function orderProviders(
    keys: ProviderKeys,
    { brainz, deezer }: ChainProviders,
    services: ProviderServices
): MetadataProvider[] {
    const discogs = createDiscogsProviders(keys, services);
    const others = createOtherProviders(keys, services);
    return [...discogs.album, ...brainz, deezer, ...discogs.song, ...others];
}

function createChain(
    config: MetadataChainConfig,
    brainz: BrainzProvider[],
    services: ProviderServices
): { chain: MetadataChain; deezer: DeezerProvider } {
    const deezerClient = new DeezerClient(services);
    const deezer = new DeezerProvider(deezerClient, services);
    const keys = getProviderKeys(config);
    const chain = new MetadataChain(
        orderProviders(keys, { brainz, deezer }, services),
        createCoverProviders(config, deezerClient, services),
        services
    );
    return { chain, deezer };
}

export function createMetadataLookups(
    config: MetadataChainConfig,
    clock: Clock,
    logger: Logger
): MetadataLookups {
    const services = createServices(config.verbose, clock, logger);
    const keys = getProviderKeys(config);
    warnAboutMissingKeys(keys, logger);
    const brainz = createBrainzProviders(keys, services);
    const { chain, deezer } = createChain(config, brainz, services);
    const corrector = new TrackCorrector(brainz, deezer, services.lookups);
    return { chain, corrector };
}
