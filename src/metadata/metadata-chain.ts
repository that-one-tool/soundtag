import type { Logger } from "../shared/logger.js";
import {
    buildProviderSearch,
    isComplete,
    mergeMetadata,
} from "./track-metadata.js";
import type {
    CoverProvider,
    MetadataProvider,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "./types.js";

interface ChainState {
    metadata: TrackMetadata;
    matched: boolean;
}

export class MetadataChain {
    constructor(
        readonly providers: MetadataProvider[],
        readonly coverProvider: CoverProvider | undefined,
        private readonly logger: Logger
    ) {}

    async find(
        search: TrackSearch,
        existingInfo: TrackInfo
    ): Promise<TrackMetadata | null> {
        const metadata = await this.collectMetadata(search, existingInfo);

        if (!metadata) {
            return null;
        }

        const completed = await this.addFallbackCover(search, metadata);
        this.logger.info(
            `Cover: ${completed.coverData ? "downloaded" : "unavailable"}`
        );
        return completed;
    }

    private async collectMetadata(
        search: TrackSearch,
        existingInfo: TrackInfo
    ): Promise<TrackMetadata | null> {
        let state: ChainState = {
            metadata: { info: { ...existingInfo }, coverData: null },
            matched: false,
        };

        for (const provider of this.providers) {
            state = await applyProvider(provider, search, state);
        }

        return state.matched ? state.metadata : null;
    }

    private async addFallbackCover(
        search: TrackSearch,
        metadata: TrackMetadata
    ): Promise<TrackMetadata> {
        if (metadata.coverData || !this.coverProvider) {
            return metadata;
        }

        const coverData = await this.coverProvider.findCover(
            buildProviderSearch(search, metadata.info)
        );
        return { ...metadata, coverData };
    }
}

async function applyProvider(
    provider: MetadataProvider,
    search: TrackSearch,
    state: ChainState
): Promise<ChainState> {
    if (isComplete(state.metadata)) {
        return state;
    }

    const candidate = await provider.findMetadata(
        buildProviderSearch(search, state.metadata.info),
        !state.metadata.coverData
    );

    if (!candidate) {
        return state;
    }

    return {
        metadata: mergeMetadata(state.metadata, candidate),
        matched: true,
    };
}
