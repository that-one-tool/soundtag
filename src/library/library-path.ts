import * as path from "node:path";
import {
    cleanAlbumDirectory,
    inferFolderSearchTerms,
    isStructuralDirectory,
} from "./folder-context.js";
import {
    cleanFilenamePart,
    parseTrackFilename,
    splitLabel,
} from "./track-name-parser.js";
import type {
    AlbumFolderTerms,
    FolderSearchTerms,
    LibraryPathTerms,
    TrackSearchTerms,
} from "./types.js";

type FolderAlbumReader = (folder: string, artist: string) => string | null;

// Rip details such as "(1991) [FLAC]" or "(Disc 1)" are not part of the album.
const RIP_NOTES =
    /(?:\s*(?:\[[^\]]*\]|\((?:\d{4}(?:\s*-\s*\d{4})?|flac|mp3|\d{3}\s*kbps|v[02]|(?:cd|disc)\s*\d+)\)))+$/iu;
const LOOSE_TRACK_FOLDER =
    /^(?:discography|discographie|singles|mp3|flac|misc|divers)$/iu;
// Only before a dash, so "99 Luftballons" keeps its number.
const TITLE_TRACK_NUMBER = /^\d{1,3}\s*-\s+/u;

function foldName(name: string): string {
    return cleanFilenamePart(name).normalize("NFC").toLowerCase();
}

function isSameFolderName(folder: string, artist: string): boolean {
    return foldName(folder) === foldName(artist);
}

function readArtistFolder(folder: string, artist: string): string | null {
    return isSameFolderName(folder, artist) ? "" : null;
}

function cleanFolderAlbum(album: string): string {
    const cleaned = cleanAlbumDirectory(album).replace(RIP_NOTES, "").trim();
    return LOOSE_TRACK_FOLDER.test(cleaned) ? "" : cleaned;
}

function isNamedFolder(folder: string): boolean {
    return !isStructuralDirectory(folder) && cleanFolderAlbum(folder) !== "";
}

function readArtistAlbumFolder(folder: string, artist: string): string | null {
    const [folderArtist, album] = splitLabel(folder);
    return isSameFolderName(folderArtist, artist) && album.trim()
        ? cleanFolderAlbum(album)
        : null;
}

const FOLDER_ALBUM_READERS: FolderAlbumReader[] = [
    readArtistFolder,
    readArtistAlbumFolder,
];

// Disc, artwork and loose-track ("Singles") folders sit between the album folder and its files.
function getNamedParent(filename: string): string {
    const folders = path.dirname(path.resolve(filename)).split(path.sep);
    return folders.findLast(isNamedFolder) ?? "";
}

function readFolderAlbum(folder: string, artist: string): string | null {
    const albums = FOLDER_ALBUM_READERS.map((read) => read(folder, artist));
    return albums.find((album) => album !== null) ?? null;
}

function dropAlbumPrefix(title: string, album: string): string {
    const [prefix, rest] = splitLabel(title);
    return rest && isSameFolderName(prefix, album) ? rest : title;
}

// "Artist - Album - 01 - Title" names the album and track number again.
function cleanPathTitle(title: string, album: string): string {
    const withoutAlbum = dropAlbumPrefix(title, album);
    return cleanFilenamePart(withoutAlbum.replace(TITLE_TRACK_NUMBER, ""));
}

function readPathTerms(
    filename: string,
    { title, artist }: TrackSearchTerms
): LibraryPathTerms | null {
    if (!artist) {
        return null;
    }

    const album = readFolderAlbum(getNamedParent(filename), artist);
    return album === null
        ? null
        : { title: cleanPathTitle(title, album), artist, album };
}

// Folders above the scanned one count too: the file's artist vouches for them.
export function parseLibraryPath(filename: string): LibraryPathTerms | null {
    return readPathTerms(filename, parseTrackFilename(path.basename(filename)));
}

// Its files need not name the artist: a service must confirm the album before it is used.
export function parseAlbumFolder(filename: string): AlbumFolderTerms | null {
    const [artist, album] = splitLabel(getNamedParent(filename));
    const terms = {
        artist: cleanFilenamePart(artist),
        album: cleanFolderAlbum(album),
    };
    return terms.artist && terms.album ? terms : null;
}

export function inferLibraryFolderTerms(
    filename: string,
    sourceRoot: string
): FolderSearchTerms {
    const terms = parseLibraryPath(filename);
    return terms
        ? { artist: terms.artist, album: terms.album }
        : inferFolderSearchTerms(filename, sourceRoot);
}
