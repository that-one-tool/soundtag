import { BatchCache } from "../../src/shared/batch-cache.js";
import { ImageCache } from "../../src/shared/image-cache.js";
import { consoleLogger } from "../../src/shared/logger.js";
import { LookupLog } from "../../src/shared/lookup-log.js";
import {
    createMetadataLookups,
    type MetadataChainConfig,
} from "../../src/metadata/create-metadata-chain.js";
import type { MetadataChain } from "../../src/metadata/metadata-chain.js";
import type {
    ExistingTags,
    ProviderNeeds,
    ProviderServices,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../../src/metadata/types.js";
import { instantClock } from "./clock.js";

export const emptyInfo: TrackInfo = {
    title: "",
    artist: "",
    album: "",
    year: "",
};

export const coverNeeds: ProviderNeeds = { cover: true, details: true };
export const detailNeeds: ProviderNeeds = { cover: false, details: true };

export const emptyTags: ExistingTags = {
    info: emptyInfo,
    extras: {},
    hasCover: false,
};

export function createTestChain(
    config: Partial<MetadataChainConfig> = {}
): MetadataChain {
    return createMetadataLookups(
        { lastFmApiKey: "test-key", verbose: false, ...config },
        instantClock,
        consoleLogger
    ).chain;
}

export function findTrackMetadata(
    search: Partial<TrackSearch>,
    config: Partial<MetadataChainConfig> = {},
    existingInfo: TrackInfo = emptyInfo
): Promise<TrackMetadata | null> {
    return createTestChain(config).find(
        { title: "", artist: "", album: "", ...search },
        { ...emptyTags, info: existingInfo }
    );
}

export function createProviderServices(
    overrides: Partial<ProviderServices> = {}
): ProviderServices {
    const logger = overrides.logger ?? consoleLogger;
    return {
        clock: instantClock,
        logger,
        images: new ImageCache(),
        cache: new BatchCache(),
        lookups: new LookupLog({ logger, clock: instantClock, verbose: false }),
        ...overrides,
    };
}
