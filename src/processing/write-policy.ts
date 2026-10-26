import {
    fillMissingExtras,
    fillMissingFields,
    getChangedExtras,
    getNewExtras,
    getStaleExtras,
    hasChangedFields,
    hasNewFields,
} from "../metadata/track-metadata.js";
import type {
    ExistingTags,
    TrackExtras,
    TrackInfo,
    TrackMetadata,
} from "../metadata/types.js";
import { isProperlyTagged } from "../tags/audio-tags.js";
import type { StoredTags, TagWrite } from "../tags/types.js";

export interface WritePolicy {
    // Services ask for a cover even when the file has one, but no fallback.
    readonly replacesCover: boolean;
    skipsTaggedTrack(stored: StoredTags): boolean;
    // Services only fill what these tags lack.
    getSearchedTags(stored: StoredTags): ExistingTags;
    getChanges(stored: StoredTags, found: TrackMetadata): TagWrite | null;
    // What found values the stored tags let through.
    keepStored(stored: StoredTags, found: TrackMetadata): TrackMetadata;
}

const EMPTY_INFO = { title: "", artist: "", album: "", year: "" };

interface Changes {
    hasNewInfo: boolean;
    extras: TrackExtras;
    coverData: Buffer | null;
}

function hasChanges({ hasNewInfo, extras, coverData }: Changes): boolean {
    return [hasNewInfo, Object.keys(extras).length > 0, coverData].some(
        Boolean
    );
}

function keepChanges(info: TrackInfo, changes: Changes): TrackMetadata | null {
    const { extras, coverData } = changes;
    return hasChanges(changes) ? { info, extras, coverData } : null;
}

function fillGaps(
    { info, extras, hasCover }: StoredTags,
    found: TrackMetadata
): TrackMetadata {
    return {
        info: fillMissingFields(info, found.info),
        extras: fillMissingExtras(extras, found.extras),
        coverData: hasCover ? null : found.coverData,
    };
}

const FILL_POLICY: WritePolicy = {
    replacesCover: false,
    skipsTaggedTrack: isProperlyTagged,
    getSearchedTags: (stored) => stored,
    getChanges: (stored, { info, extras, coverData }) =>
        keepChanges(info, {
            hasNewInfo: hasNewFields(stored.info, info),
            extras: getNewExtras(stored.extras, extras),
            coverData,
        }),
    keepStored: fillGaps,
};

function getOverwrite(
    stored: StoredTags,
    { info, extras, coverData }: TrackMetadata
): TagWrite | null {
    const changes = keepChanges(info, {
        hasNewInfo: hasChangedFields(stored.info, info),
        extras: getChangedExtras(stored.extras, extras),
        coverData,
    });
    const clearedExtras = getStaleExtras(stored.extras, extras);
    return changes && { ...changes, clearedExtras };
}

const OVERWRITE_POLICY: WritePolicy = {
    replacesCover: true,
    skipsTaggedTrack: () => false,
    getSearchedTags: ({ hasCover }) => ({
        info: EMPTY_INFO,
        extras: {},
        hasCover,
    }),
    getChanges: getOverwrite,
    keepStored: (_stored, found) => found,
};

export function getWritePolicy(overwrite: boolean): WritePolicy {
    return overwrite ? OVERWRITE_POLICY : FILL_POLICY;
}
