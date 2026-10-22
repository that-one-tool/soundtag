import {
    EXTRA_GROUPS,
    removeUnknownValues,
    TRACK_FIELDS,
    type ExtraGroup,
} from "../metadata/track-metadata.js";
import type {
    TrackExtras,
    TrackInfo,
    TrackMetadata,
} from "../metadata/types.js";
import { isSameAlbum } from "../metadata/track-matching.js";
import type { StoredTags, TagWrite } from "../tags/types.js";

export interface StoredTrack {
    tags: StoredTags;
    cover: Buffer | null;
}

type ExtraField = keyof TrackExtras;

const RELEASE_GROUPS = EXTRA_GROUPS.filter(([lead]) => lead !== "genre");

function isChangedText(stored: string, found: string): boolean {
    const value = found.trim();
    return Boolean(value) && value !== stored;
}

// Stores skip empty fields, so unchanged ones are left as they are.
function getChangedInfo(stored: TrackInfo, found: TrackInfo): TrackInfo {
    const entries = TRACK_FIELDS.map((field) => [
        field,
        isChangedText(stored[field], found[field]) ? found[field] : "",
    ]);
    return Object.fromEntries(entries) as TrackInfo;
}

function isChangedGroup(
    stored: TrackExtras,
    found: TrackExtras,
    group: ExtraGroup
): boolean {
    const hasLead = found[group[0]] !== undefined;
    return hasLead && group.some((field) => found[field] !== stored[field]);
}

function pickGroups(extras: TrackExtras, groups: ExtraGroup[]): TrackExtras {
    const fields = groups.flat();
    return removeUnknownValues(
        Object.fromEntries(fields.map((field) => [field, extras[field]]))
    );
}

function isNewRelease(stored: TrackInfo, found: TrackInfo): boolean {
    return (
        Boolean(found.album.trim()) && !isSameAlbum(found.album, stored.album)
    );
}

function getClearedExtras(
    stored: TrackExtras,
    found: TrackExtras,
    groups: ExtraGroup[]
): ExtraField[] {
    return groups
        .flat()
        .filter((field) => found[field] === undefined)
        .filter((field) => stored[field] !== undefined);
}

function getAbandonedGroups(found: TrackExtras): ExtraGroup[] {
    return RELEASE_GROUPS.filter(([lead]) => found[lead] === undefined);
}

interface ExtrasChange {
    extras: TrackExtras;
    clearedExtras: ExtraField[];
}

// Same release: a value not found is still right, so it is kept.
function getSameReleaseChange(
    stored: TrackExtras,
    found: TrackExtras
): ExtrasChange {
    const kept = { ...stored, ...removeUnknownValues(found) };
    const changed = EXTRA_GROUPS.filter((group) =>
        isChangedGroup(stored, kept, group)
    );
    return { extras: pickGroups(kept, changed), clearedExtras: [] };
}

// A new album makes the old release's numbers and album artist wrong.
function getNewReleaseChange(
    stored: TrackExtras,
    found: TrackExtras
): ExtrasChange {
    const changed = EXTRA_GROUPS.filter((group) =>
        isChangedGroup(stored, found, group)
    );
    const replaced = [...changed, ...getAbandonedGroups(found)];
    return {
        extras: pickGroups(found, changed),
        clearedExtras: getClearedExtras(stored, found, replaced),
    };
}

function getExtrasChange(
    stored: StoredTags,
    found: TrackMetadata
): ExtrasChange {
    return isNewRelease(stored.info, found.info)
        ? getNewReleaseChange(stored.extras, found.extras)
        : getSameReleaseChange(stored.extras, found.extras);
}

function isSameCover(stored: Buffer | null, found: Buffer): boolean {
    return Boolean(stored?.equals(found));
}

function getChangedCover(
    stored: Buffer | null,
    found: Buffer | null
): Buffer | null {
    if (!found) {
        return null;
    }

    return isSameCover(stored, found) ? null : found;
}

function hasChanges(overwrite: Required<TagWrite>): boolean {
    const { info, extras, coverData, clearedExtras } = overwrite;
    const changed = [
        ...Object.values(info).filter(Boolean),
        ...Object.keys(extras),
        ...clearedExtras,
    ];
    return changed.length > 0 || Boolean(coverData);
}

export function getOverwrite(
    { tags, cover }: StoredTrack,
    found: TrackMetadata
): TagWrite | null {
    const overwrite = {
        info: getChangedInfo(tags.info, found.info),
        ...getExtrasChange(tags, found),
        coverData: getChangedCover(cover, found.coverData),
    };
    return hasChanges(overwrite) ? overwrite : null;
}
