import type { Logger } from "../shared/logger.js";
import {
    buildProviderSearch,
    isComplete,
    mergeMetadata,
} from "./track-metadata.js";
import type {
    CoverProvider,
    ExistingTags,
    MetadataProvider,
    TrackMetadata,
    TrackSearch,
} from "./types.js";

interface ChainState {
    metadata: TrackMetadata;
    matched: boolean;
    hasExistingCover: boolean;
}

function getCoverStatus({ metadata, hasExistingCover }: ChainState): string {
    if (hasExistingCover) {
        return "kept";
    }

    return metadata.coverData ? "downloaded" : "unavailable";
}

function needsCover({ metadata, hasExistingCover }: ChainState): boolean {
    return !hasExistingCover && !metadata.coverData;
}

function createInitialState({
    info,
    extras,
    hasCover,
}: ExistingTags): ChainState {
    return {
        metadata: { info: { ...info }, extras: { ...extras }, coverData: null },
        matched: false,
        hasExistingCover: hasCover,
    };
}

export class MetadataChain {
    constructor(
        readonly providers: MetadataProvider[],
        readonly coverProvider: CoverProvider | undefined,
        private readonly logger: Logger
    ) {}

    async find(
        search: TrackSearch,
        existing: ExistingTags
    ): Promise<TrackMetadata | null> {
        const state = await this.collectMetadata(search, existing);

        if (!state.matched) {
            return null;
        }

        const completed = await this.addFallbackCover(search, state);
        this.logger.info(`Cover: ${getCoverStatus(completed)}`);
        return completed.metadata;
    }

    private async collectMetadata(
        search: TrackSearch,
        existing: ExistingTags
    ): Promise<ChainState> {
        let state = createInitialState(existing);

        for (const provider of this.providers) {
            state = await this.applyProvider(provider, search, state);
        }

        return state;
    }

    private async applyProvider(
        provider: MetadataProvider,
        search: TrackSearch,
        state: ChainState
    ): Promise<ChainState> {
        if (isComplete(state.metadata, state.hasExistingCover)) {
            return state;
        }

        this.logger.info(`Querying ${provider.name}...`);
        const candidate = await provider.findMetadata(
            buildProviderSearch(search, state.metadata.info),
            needsCover(state)
        );
        return mergeCandidate(state, candidate);
    }

    private async addFallbackCover(
        search: TrackSearch,
        state: ChainState
    ): Promise<ChainState> {
        if (!needsCover(state) || !this.coverProvider) {
            return state;
        }

        this.logger.info(`Searching ${this.coverProvider.name} for a cover...`);
        const coverData = await this.coverProvider.findCover(
            buildProviderSearch(search, state.metadata.info)
        );
        return { ...state, metadata: { ...state.metadata, coverData } };
    }
}

function mergeCandidate(
    state: ChainState,
    candidate: TrackMetadata | null
): ChainState {
    if (!candidate) {
        return state;
    }

    return {
        ...state,
        metadata: mergeMetadata(state.metadata, candidate),
        matched: true,
    };
}
