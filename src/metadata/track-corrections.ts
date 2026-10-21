import { isSameCredit, isSameWording } from "./track-matching.js";
import { extractYear } from "./track-metadata.js";
import type { CanonicalTrack, TagCorrection, TrackInfo } from "./types.js";

type CorrectionRule = (current: string, canonical: CanonicalTrack) => string;

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

const CORRECTION_RULES: [keyof TrackInfo, CorrectionRule][] = [
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

export function getCorrections(
    info: TrackInfo,
    canonical: CanonicalTrack
): TagCorrection[] {
    return CORRECTION_RULES.map(([field, correct]) => ({
        field,
        from: info[field],
        to: correct(info[field], canonical),
    })).filter(({ from, to }) => to && to !== from);
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

function getEarliestYear(tracks: CanonicalTrack[]): string {
    const years = tracks.map(({ firstReleaseYear }) => firstReleaseYear);
    return years.filter(Boolean).toSorted()[0] ?? "";
}

// The first source that names the song gives the spelling of both fields.
export function mergeCanonicalTracks(tracks: CanonicalTrack[]): CanonicalTrack {
    const named = tracks.find(({ title }) => title) ?? EMPTY_CANONICAL_TRACK;
    return {
        title: named.title,
        artist: named.artist,
        firstReleaseYear: getEarliestYear(tracks),
    };
}
