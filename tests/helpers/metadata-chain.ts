import {
    createMetadataChain,
    type MetadataChainConfig,
} from "../../src/create-metadata-chain.js";
import type { MetadataChain } from "../../src/metadata-chain.js";
import type { TrackInfo, TrackMetadata, TrackSearch } from "../../src/types.js";
import { instantClock } from "./clock.js";

export const emptyInfo: TrackInfo = {
    title: "",
    artist: "",
    album: "",
    year: "",
};

export function createTestChain(
    config: Partial<MetadataChainConfig> = {}
): MetadataChain {
    return createMetadataChain(
        { lastFmApiKey: "test-key", verbose: false, ...config },
        instantClock
    );
}

export function findTrackMetadata(
    search: Partial<TrackSearch>,
    config: Partial<MetadataChainConfig> = {},
    existingInfo: TrackInfo = emptyInfo
): Promise<TrackMetadata | null> {
    return createTestChain(config).find(
        { title: "", artist: "", album: "", ...search },
        existingInfo
    );
}
