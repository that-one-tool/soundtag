import type { TrackInfo } from "../metadata/types.js";
import { normalizeTagValue } from "./album-tags.js";

// Spaced only, so hyphenated names such as "Jay-Z" are kept.
const LABEL_SEPARATOR = /\s[-–—]\s/u;

function containsArtist({ title, artist }: TrackInfo): boolean {
    const normalizedArtist = normalizeTagValue(artist);
    return (
        Boolean(normalizedArtist) &&
        normalizeTagValue(title).includes(normalizedArtist)
    );
}

// A label such as "Artist - Title" in the title tag spoils both the search and renames.
export function hasSuspectTitle(info: TrackInfo): boolean {
    return LABEL_SEPARATOR.test(info.title) || containsArtist(info);
}

export function hasSuspectTags(info: TrackInfo): boolean {
    return !info.artist.trim() || hasSuspectTitle(info);
}
