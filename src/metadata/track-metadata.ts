import type {
    TrackExtras,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "./types.js";

const YEAR_PATTERN = /\b\d{4}\b/;

export const EMPTY_TRACK_INFO: TrackInfo = {
    title: "",
    artist: "",
    album: "",
    year: "",
};

function pickFilled(value: string, fallback: string): string {
    return value.trim() ? value : fallback;
}

export function fillMissingFields(
    info: TrackInfo,
    candidate: TrackInfo
): TrackInfo {
    return {
        title: pickFilled(info.title, candidate.title),
        artist: pickFilled(info.artist, candidate.artist),
        album: pickFilled(info.album, candidate.album),
        year: pickFilled(info.year, candidate.year),
    };
}

export function removeUnknownValues<Values extends object>(
    values: Values
): Values {
    const knownEntries = Object.entries(values).filter(
        ([, value]) => value !== undefined
    );
    return Object.fromEntries(knownEntries) as Values;
}

type ExtraGroup = readonly (keyof TrackExtras)[];

// A count only makes sense with the position it came from, so they move together.
const EXTRA_GROUPS: readonly ExtraGroup[] = [
    ["genre"],
    ["albumArtist"],
    ["trackNumber", "trackCount"],
    ["discNumber", "discCount"],
];

function hasAnyField(extras: TrackExtras, group: ExtraGroup): boolean {
    return group.some((field) => extras[field] !== undefined);
}

function hasLeadField(extras: TrackExtras, group: ExtraGroup): boolean {
    return extras[group[0]] !== undefined;
}

function pickGroup(extras: TrackExtras, group: ExtraGroup): TrackExtras {
    return Object.fromEntries(group.map((field) => [field, extras[field]]));
}

function combineGroups(groups: TrackExtras[]): TrackExtras {
    return removeUnknownValues(Object.assign({}, ...groups));
}

function pickFilledGroup(
    extras: TrackExtras,
    candidate: TrackExtras,
    group: ExtraGroup
): TrackExtras {
    const keepsCurrent =
        hasAnyField(extras, group) || !hasLeadField(candidate, group);
    return pickGroup(keepsCurrent ? extras : candidate, group);
}

export function fillMissingExtras(
    extras: TrackExtras,
    candidate: TrackExtras
): TrackExtras {
    return combineGroups(
        EXTRA_GROUPS.map((group) => pickFilledGroup(extras, candidate, group))
    );
}

export function getNewExtras(
    existing: TrackExtras,
    merged: TrackExtras
): TrackExtras {
    const newGroups = EXTRA_GROUPS.filter(
        (group) => !hasAnyField(existing, group) && hasLeadField(merged, group)
    );
    return combineGroups(newGroups.map((group) => pickGroup(merged, group)));
}

export function hasAllDetails({ info, extras }: TrackMetadata): boolean {
    const hasAllExtras = EXTRA_GROUPS.every((group) =>
        hasLeadField(extras, group)
    );
    return hasAllExtras && Boolean(info.year.trim());
}

export function optionalText(value: string | undefined): string | undefined {
    return value?.trim() || undefined;
}

export function optionalCount(value: number | undefined): number | undefined {
    return value && value > 0 ? value : undefined;
}

export function hasNewFields(existing: TrackInfo, found: TrackInfo): boolean {
    return TRACK_FIELDS.some(
        (field) => !existing[field].trim() && found[field].trim()
    );
}

export function getFirstFilled(...values: (string | undefined)[]): string {
    return values.find(Boolean) ?? "";
}

export function valueOrEmpty(value: string | undefined): string {
    return value ?? "";
}

export function trimOrEmpty(value: string | undefined): string {
    return value?.trim() ?? "";
}

export const TRACK_FIELDS: readonly (keyof TrackInfo)[] = [
    "title",
    "artist",
    "album",
    "year",
];

export function getFilledFields(info: TrackInfo): Partial<TrackInfo> {
    const filledFields = TRACK_FIELDS.filter((field) => info[field].trim());
    return Object.fromEntries(
        filledFields.map((field) => [field, info[field]])
    );
}

export function mergeMetadata(
    current: TrackMetadata,
    candidate: TrackMetadata
): TrackMetadata {
    return {
        info: fillMissingFields(current.info, candidate.info),
        extras: fillMissingExtras(current.extras, candidate.extras),
        coverData: current.coverData ?? candidate.coverData,
    };
}

function hasRequiredExtras({ genre, trackNumber }: TrackExtras): boolean {
    return Boolean(genre) && Boolean(trackNumber);
}

function hasAllFields(info: TrackInfo): boolean {
    return TRACK_FIELDS.every((field) => info[field].trim());
}

function hasAnyCover(
    coverData: Buffer | null,
    hasExistingCover: boolean
): boolean {
    return hasExistingCover || Boolean(coverData);
}

export function isComplete(
    { info, extras, coverData }: TrackMetadata,
    hasExistingCover: boolean
): boolean {
    return (
        hasAnyCover(coverData, hasExistingCover) &&
        hasRequiredExtras(extras) &&
        hasAllFields(info)
    );
}

export function extractYear(text = ""): string {
    const match = YEAR_PATTERN.exec(text);
    return match ? match[0] : "";
}

export function buildProviderSearch(
    search: TrackSearch,
    info: TrackInfo
): TrackSearch {
    return {
        title: pickFilled(info.title, search.title),
        artist: pickFilled(info.artist, search.artist),
        album: pickFilled(search.album, info.album),
    };
}
