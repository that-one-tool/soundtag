import { isSameCredit, isSameWording } from "./track-matching.js";
import { extractYear, getEarliestYear } from "./track-metadata.js";
import type {
    CanonicalTrack,
    IdentityField,
    TagCorrection,
    TrackInfo,
} from "./types.js";

type CorrectionRule = (current: string, canonical: CanonicalTrack) => string;

type FieldRule = [keyof TrackInfo, CorrectionRule];

const NO_CORRECTION = "";

const EMPTY_CANONICAL_TRACK: CanonicalTrack = {
    title: "",
    artist: "",
    firstReleaseYear: "",
};

function respellWhen(
    isSame: (found: string, current: string) => boolean,
    found: string,
    current: string
): string {
    return found && isSame(found, current) ? found : NO_CORRECTION;
}

// A compilation or reissue year is later than the song's first release.
function isEarlierYear(year: string, current: string): boolean {
    const currentYear = extractYear(current);
    return !currentYear || year < currentYear;
}

function correctYear(current: string, { firstReleaseYear }: CanonicalTrack) {
    const isEarlier =
        firstReleaseYear && isEarlierYear(firstReleaseYear, current);
    return isEarlier ? firstReleaseYear : NO_CORRECTION;
}

const CORRECTION_RULES: FieldRule[] = [
    [
        "title",
        (current, { title }) => respellWhen(isSameWording, title, current),
    ],
    [
        "artist",
        (current, { artist }) => respellWhen(isSameCredit, artist, current),
    ],
    ["year", correctYear],
];

function getReplaceRule(field: IdentityField): FieldRule {
    return [field, (_current, canonical) => canonical[field]];
}

function applyRules(
    rules: FieldRule[],
    info: TrackInfo,
    canonical: CanonicalTrack
): TagCorrection[] {
    return rules
        .map(([field, correct]) => ({
            field,
            from: info[field],
            to: correct(info[field], canonical),
        }))
        .filter(({ from, to }) => to && to !== from);
}

export function getCorrections(
    info: TrackInfo,
    canonical: CanonicalTrack
): TagCorrection[] {
    return applyRules(CORRECTION_RULES, info, canonical);
}

export function getIdentityCorrections(
    info: TrackInfo,
    canonical: CanonicalTrack,
    fields: IdentityField[]
): TagCorrection[] {
    const rules: FieldRule[] = [
        ...fields.map(getReplaceRule),
        ["year", correctYear],
    ];
    return applyRules(rules, info, canonical);
}

export function applyCorrections(
    info: TrackInfo,
    corrections: TagCorrection[]
): TrackInfo {
    const corrected = corrections.map(({ field, to }) => [field, to]);
    return { ...info, ...Object.fromEntries(corrected) };
}

export function describeCorrection({ field, from, to }: TagCorrection): string {
    return `${field}: "${from}" → "${to}"`;
}

// The first source that names the song gives the spelling of both fields.
export function mergeCanonicalTracks(tracks: CanonicalTrack[]): CanonicalTrack {
    const named = tracks.find(({ title }) => title) ?? EMPTY_CANONICAL_TRACK;
    return {
        title: named.title,
        artist: named.artist,
        firstReleaseYear: getEarliestYear(
            tracks.map(({ firstReleaseYear }) => firstReleaseYear)
        ),
    };
}
