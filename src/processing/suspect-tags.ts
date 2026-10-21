import { isVariousArtists } from "../metadata/track-matching.js";
import type { IdentityField, TrackInfo } from "../metadata/types.js";
import { normalizeTagValue } from "./album-tags.js";

// Spaced only, so hyphenated names such as "Jay-Z" are kept.
const LABEL_SEPARATOR = /\s[-–—]\s/u;
const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;

// Padded with spaces so artist "Air" is not found inside "Fair Game".
function getPaddedWords(value: string): string {
    const words = normalizeTagValue(value).split(WORD_SEPARATOR);
    return ` ${words.filter(Boolean).join(" ")} `;
}

function containsArtist({ title, artist }: TrackInfo): boolean {
    const artistWords = getPaddedWords(artist);
    return (
        artistWords.trim() !== "" && getPaddedWords(title).includes(artistWords)
    );
}

// A label such as "Artist - Title" in the title tag spoils both the search and renames.
export function hasSuspectTitle(info: TrackInfo): boolean {
    return LABEL_SEPARATOR.test(info.title) || containsArtist(info);
}

export function hasSuspectTags(info: TrackInfo): boolean {
    return !info.artist.trim() || hasSuspectTitle(info);
}

export function splitSuspectTitle(title: string): [string, string] {
    const separator = LABEL_SEPARATOR.exec(title);
    return separator
        ? [
              title.slice(0, separator.index),
              title.slice(separator.index + separator[0].length),
          ]
        : ["", ""];
}

// Compilations credited to "Various Artists" lose the real artist.
function hasUnknownArtist({ artist }: TrackInfo): boolean {
    return !artist.trim() || isVariousArtists(artist);
}

// With a known artist, "Hello - Live" is a version note, not a label.
function hasWrongTitle(info: TrackInfo): boolean {
    const isLabel = LABEL_SEPARATOR.test(info.title) && hasUnknownArtist(info);
    return isLabel || containsArtist(info);
}

const SUSPECT_FIELD_CHECKS: [IdentityField, (info: TrackInfo) => boolean][] = [
    ["title", (info) => !info.title.trim() || hasWrongTitle(info)],
    ["artist", hasUnknownArtist],
];

export function getSuspectFields(info: TrackInfo): IdentityField[] {
    return SUSPECT_FIELD_CHECKS.filter(([, isSuspect]) => isSuspect(info)).map(
        ([field]) => field
    );
}

export function hasSuspectIdentity(info: TrackInfo): boolean {
    return getSuspectFields(info).length > 0;
}
