import { valueOrEmpty } from "./track-metadata.js";
import type { TrackSearch } from "./types.js";

export interface FoundTrack {
    title?: string;
    artist?: string;
}

function normalizeAlbum(album: string | undefined): string {
    return valueOrEmpty(album).trim().toLowerCase();
}

// Track and disc numbers from another release (compilation, single) would be wrong.
export function isSameRelease(
    foundAlbum: string | undefined,
    searchedAlbum: string
): boolean {
    return (
        !searchedAlbum ||
        normalizeAlbum(foundAlbum) === normalizeAlbum(searchedAlbum)
    );
}

// Brackets that name another version (live, karaoke, remix) must still differ.
const NOISE_BRACKET =
    /[([][^)\]]*\b(?:remaster|feat|ft\b|explicit|mono|stereo)[^)\]]*[)\]]/g;

function normalizeName(name: string | undefined): string {
    return valueOrEmpty(name)
        .toLowerCase()
        .normalize("NFD")
        .replaceAll(/\p{M}/gu, "")
        .replaceAll(NOISE_BRACKET, "")
        .replaceAll(/[^\p{L}\p{N}]/gu, "");
}

export function isSameName(found: string | undefined, searched: string) {
    return normalizeName(found) === normalizeName(searched);
}

// The first search result can be a karaoke or cover version, whose extras would stick.
export function isSameTrack(
    found: FoundTrack,
    { title, artist }: TrackSearch
): boolean {
    const isSameArtist = !artist || isSameName(found.artist, artist);
    return isSameArtist && isSameName(found.title, title);
}
