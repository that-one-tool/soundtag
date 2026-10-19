import * as path from "node:path";
import type { TrackSearchTerms } from "./types.js";

const LABEL_SEPARATOR = /\s+-\s+|\s*[–—]\s*/;
const TRACK_NUMBER_PREFIX =
    /^\s*(?:\d{1,2}[._-]\d{1,2}|\d{1,3})(?:\s*[-._]\s*|\s+)/;

export function cleanFilenamePart(value: string): string {
    return value.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}

export function splitLabel(label: string): [string, string] {
    const separator = LABEL_SEPARATOR.exec(label);

    if (!separator) {
        return ["", ""];
    }

    return [
        label.slice(0, separator.index),
        label.slice(separator.index + separator[0].length),
    ];
}

function splitArtistAndTitle(name: string): TrackSearchTerms | null {
    const parts = splitLabel(name).map(cleanFilenamePart);
    const [artist, title] = parts;
    return parts.every(Boolean) ? { artist, title } : null;
}

export function parseTrackFilename(filename: string): TrackSearchTerms {
    const name = cleanFilenamePart(
        path.parse(filename).name.replace(TRACK_NUMBER_PREFIX, "")
    );
    return splitArtistAndTitle(name) ?? { title: name };
}
