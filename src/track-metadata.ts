import type { TrackInfo, TrackMetadata, TrackSearch } from "./types.js";

const YEAR_PATTERN = /\b\d{4}\b/;

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

export function mergeMetadata(
    current: TrackMetadata,
    candidate: TrackMetadata
): TrackMetadata {
    return {
        info: fillMissingFields(current.info, candidate.info),
        coverData: current.coverData ?? candidate.coverData,
    };
}

export function isComplete({ info, coverData }: TrackMetadata): boolean {
    const fields = [info.title, info.artist, info.album, info.year];
    return Boolean(coverData) && fields.every((field) => field.trim());
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
