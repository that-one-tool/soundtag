import type { LibraryPathTerms } from "../library/types.js";
import {
    isSameAlbum,
    isSameArtist,
    isSameName,
    hasNoteAfterName,
} from "../metadata/track-matching.js";
import type { TagCorrection, TrackInfo } from "../metadata/types.js";

type PathField = keyof LibraryPathTerms;

type SameValueCheck = (current: string, pathValue: string) => boolean;

// Lenient like the searches, and a tag that only adds a note ("Song (Live)") is kept.
const PATH_FIELD_CHECKS: [PathField, SameValueCheck[]][] = [
    ["title", [isSameName, hasNoteAfterName]],
    ["artist", [isSameArtist]],
    ["album", [isSameAlbum, hasNoteAfterName]],
];

// Empty fields are left to the search, since file names lose characters such as "?".
function isKeptValue(
    current: string,
    pathValue: string,
    checks: SameValueCheck[]
): boolean {
    if (!pathValue || !current.trim()) {
        return true;
    }

    return checks.some((isSame) => isSame(current, pathValue));
}

export function getPathCorrections(
    info: TrackInfo,
    terms: LibraryPathTerms | null
): TagCorrection[] {
    if (!terms) {
        return [];
    }

    return PATH_FIELD_CHECKS.filter(
        ([field, checks]) => !isKeptValue(info[field], terms[field], checks)
    ).map(([field]) => ({ field, from: info[field], to: terms[field] }));
}

function findLater(
    later: TagCorrection[],
    field: keyof TrackInfo
): TagCorrection | undefined {
    return later.find((correction) => correction.field === field);
}

// The services correct what the path already corrected, so "from" stays the stored value.
export function chainCorrections(
    earlier: TagCorrection[],
    later: TagCorrection[]
): TagCorrection[] {
    const updated = earlier.map((correction) => ({
        ...correction,
        to: findLater(later, correction.field)?.to ?? correction.to,
    }));
    const added = later.filter(({ field }) => !findLater(earlier, field));
    return [...updated, ...added].filter(({ from, to }) => from !== to);
}
