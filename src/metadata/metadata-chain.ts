import type { LookupLog } from "../shared/lookup-log.js";
import { isSameName } from "./track-matching.js";
import {
    buildProviderSearch,
    getAddedFieldNames,
    hasAllDetails,
    isComplete,
    mergeMetadata,
} from "./track-metadata.js";
import type {
    CoverProvider,
    ExistingTags,
    MetadataProvider,
    ProviderNeeds,
    ProviderServices,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "./types.js";

interface ChainState {
    metadata: TrackMetadata;
    matched: boolean;
    hasExistingCover: boolean;
    replacesCover: boolean;
}

export interface FindOptions {
    // Ask the services for a cover even when the file has one, but no fallback.
    replaceCover?: boolean;
}

function nameSong({ title, artist }: TrackInfo): string {
    return artist ? `"${title}" by ${artist}` : `"${title}"`;
}

// Loose fallbacks can match another song, which the log must show.
function describeCandidate(
    search: TrackSearch,
    current: TrackMetadata,
    found: TrackMetadata
): string {
    const fields = getAddedFieldNames(current, found).join(", ");
    if (isSameName(found.info.title, search.title)) {
        return fields;
    }

    const song = nameSong(found.info);
    return fields ? `${song}: ${fields}` : song;
}

function keepsExistingCover(state: ChainState): boolean {
    return state.hasExistingCover && !state.replacesCover;
}

function needsCover(state: ChainState): boolean {
    return !keepsExistingCover(state) && !state.metadata.coverData;
}

function needsFallbackCover({
    metadata,
    hasExistingCover,
}: ChainState): boolean {
    return !hasExistingCover && !metadata.coverData;
}

function getNeeds(state: ChainState): ProviderNeeds {
    return {
        cover: needsCover(state),
        details: !hasAllDetails(state.metadata),
    };
}

function createInitialState(
    { info, extras, hasCover }: ExistingTags,
    { replaceCover = false }: FindOptions
): ChainState {
    return {
        metadata: { info: { ...info }, extras: { ...extras }, coverData: null },
        matched: false,
        hasExistingCover: hasCover,
        replacesCover: replaceCover,
    };
}

export class MetadataChain {
    constructor(
        readonly providers: MetadataProvider[],
        readonly coverProviders: CoverProvider[],
        private readonly services: ProviderServices
    ) {}

    get lookups(): LookupLog {
        return this.services.lookups;
    }

    clearCache(): void {
        this.services.images.clear();
        this.services.cache.clear();
    }

    async find(
        search: TrackSearch,
        existing: ExistingTags,
        options: FindOptions = {}
    ): Promise<TrackMetadata | null> {
        const state = await this.collectMetadata(search, existing, options);

        if (!state.matched) {
            return null;
        }

        const completed = await this.addFallbackCover(search, state);
        return completed.metadata;
    }

    private async collectMetadata(
        search: TrackSearch,
        existing: ExistingTags,
        options: FindOptions
    ): Promise<ChainState> {
        let state = createInitialState(existing, options);

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
        if (isComplete(state.metadata, keepsExistingCover(state))) {
            return state;
        }

        const providerSearch = buildProviderSearch(search, state.metadata.info);
        const candidate = await this.services.lookups.call(
            provider.name,
            () => provider.findMetadata(providerSearch, getNeeds(state)),
            (found) => describeCandidate(providerSearch, state.metadata, found)
        );
        return mergeCandidate(state, candidate);
    }

    private async addFallbackCover(
        search: TrackSearch,
        state: ChainState
    ): Promise<ChainState> {
        for (const coverProvider of this.coverProviders) {
            state = await this.applyCoverProvider(coverProvider, search, state);
        }

        return state;
    }

    private async applyCoverProvider(
        coverProvider: CoverProvider,
        search: TrackSearch,
        state: ChainState
    ): Promise<ChainState> {
        if (!needsFallbackCover(state)) {
            return state;
        }

        const coverData = await this.services.lookups.call(
            coverProvider.name,
            () =>
                coverProvider.findCover(
                    buildProviderSearch(search, state.metadata.info)
                ),
            () => "cover"
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
