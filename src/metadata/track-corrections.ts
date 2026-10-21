import {
    isSameCredit,
    isSameName,
    isSameRelease,
    isSameWording,
} from "./track-matching.js";
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
    albums: [],
    artistAlbums: [],
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
        albums: [...new Set(tracks.flatMap(({ albums }) => albums))],
        artistAlbums: [
            ...new Set(tracks.flatMap(({ artistAlbums }) => artistAlbums)),
        ],
    };
}

const SUBTITLE_START = /\s*[:([]|\s[-–—]\s/u;

// Tags and services both add subtitles and notes: "Gold: Greatest Hits",
// "Get Lucky - Single", "Random Access Memories (Deluxe Edition)".
function getAlbumNames(album: string): string[] {
    const names = [album, album.split(SUBTITLE_START)[0]];
    return names.filter((name) => name.trim());
}

function isSameAlbumName(release: string, album: string): boolean {
    return Boolean(release.trim()) && isSameRelease({ album: release }, album);
}

function isListedAlbum(album: string, albums: string[]): boolean {
    const names = getAlbumNames(album);
    return albums.some((release) =>
        getAlbumNames(release).some((releaseName) =>
            names.some((name) => isSameAlbumName(releaseName, name))
        )
    );
}

// A missing album is for fill mode, and a song without known albums proves nothing.
export function isWrongAlbum(album: string, albums: string[]): boolean {
    const isKnown = Boolean(album.trim()) && albums.length > 0;
    return isKnown && !isListedAlbum(album, albums);
}

// Its folder naming the same album means the tag was set on purpose.
export function isDisputedAlbum(
    { album }: TrackInfo,
    albums: string[],
    folderAlbum: string
): boolean {
    return isWrongAlbum(album, albums) && !isSameAlbumName(folderAlbum, album);
}

// Exact names only, so a "Live" folder does not pick "Live: At Wembley".
export function findAlbumReplacement(
    releases: string[],
    candidates: string[]
): string {
    const matches = candidates.flatMap((candidate) =>
        releases.filter((release) => isSameAlbumName(candidate, release))
    );
    return matches[0] ?? "";
}

// A loose artist folder is not an album name.
export function getFolderCandidate(
    folderAlbum: string,
    artist: string
): string {
    return isSameName(folderAlbum, artist) ? "" : folderAlbum;
}
