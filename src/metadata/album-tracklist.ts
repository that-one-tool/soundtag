import type { AlbumTrackEntry } from "./types.js";

export interface TrackPlace {
    title: string;
    artist?: string;
    disc: number;
    track: number;
}

function countDiscTracks(places: TrackPlace[], disc: number): number {
    return places.filter((place) => place.disc === disc).length;
}

// Restarting numbers without discs ("CD1" and "CD2" headings) cannot be placed.
function hasSharedPlaces(places: TrackPlace[]): boolean {
    const keys = places.map(({ disc, track }) => `${disc}-${track}`);
    return new Set(keys).size < keys.length;
}

function toEntry(place: TrackPlace, places: TrackPlace[], discCount: number) {
    const { title, artist, disc, track } = place;
    const entry = {
        title,
        trackNumber: track,
        trackCount: countDiscTracks(places, disc),
        discNumber: disc,
        discCount,
    };
    return artist ? { ...entry, artist } : entry;
}

export function buildTracklist(places: TrackPlace[]): AlbumTrackEntry[] {
    if (hasSharedPlaces(places)) {
        return [];
    }

    const discCount = Math.max(0, ...places.map(({ disc }) => disc));
    return places.map((place) => toEntry(place, places, discCount));
}
