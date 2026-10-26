import * as path from "node:path";
import { cleanFilenamePart, splitLabel } from "./track-name-parser.js";
import type { FolderSearchTerms } from "./types.js";

const STRUCTURAL_DIRECTORY_PATTERNS = [
    /^(?:(?:artist|album|artiste)\s+)?(?:unknown|inconnu|unknown artist|unknown album|artiste inconnu|album inconnu|various artists|va|miscellaneous|misc)$/,
    /^(?:cover|covers|artwork|booklet|cd|disc|disk)(?:[\s._-]*\d+)?$/,
    /^(?:music|musique|audio|media|library|bibliothèque|itunes music)$/,
    /^\d{4}(?:\s*[-._]\s*\d{4})?$/,
    /^(?:part|partie|volume|vol\.?)[\s._-]*\d+$/,
];
const ALBUM_MARKER =
    /\b(?:ost|soundtrack|compilation|best of|greatest hits)\b/i;

export function isStructuralDirectory(name: string): boolean {
    const normalized = name.trim().toLowerCase();
    return (
        !normalized ||
        STRUCTURAL_DIRECTORY_PATTERNS.some((pattern) =>
            pattern.test(normalized)
        )
    );
}

export function cleanAlbumDirectory(name: string): string {
    return name
        .replace(/^\s*\d{4}\s*[-._]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
}

function removeEmptyTerms(terms: FolderSearchTerms): FolderSearchTerms {
    return Object.fromEntries(
        Object.entries(terms).filter(([, value]) => value)
    );
}

function getMeaningfulDirectories(
    filename: string,
    sourceRoot: string
): string[] {
    const relativeDirectory = path.relative(
        path.resolve(sourceRoot),
        path.dirname(path.resolve(filename))
    );
    return relativeDirectory
        .split(path.sep)
        .filter((directory) => !isStructuralDirectory(directory));
}

function splitArtistAndAlbum(albumLabel: string): FolderSearchTerms | null {
    if (ALBUM_MARKER.test(albumLabel)) {
        return null;
    }

    const [artist, album] = splitLabel(albumLabel);
    const terms = {
        artist: cleanFilenamePart(artist),
        album: cleanAlbumDirectory(album),
    };
    return Object.values(terms).every(Boolean) ? terms : null;
}

function inferFromCombinedFolder(directory: string): FolderSearchTerms {
    const albumLabel = cleanAlbumDirectory(directory);
    return (
        splitArtistAndAlbum(albumLabel) ??
        removeEmptyTerms({ album: albumLabel })
    );
}

function inferFromNestedFolders(directories: string[]): FolderSearchTerms {
    const [artistDirectory, albumDirectory] = directories.slice(-2);
    return removeEmptyTerms({
        artist: cleanFilenamePart(artistDirectory),
        album: cleanAlbumDirectory(albumDirectory),
    });
}

export function inferFolderSearchTerms(
    filename: string,
    sourceRoot: string
): FolderSearchTerms {
    const directories = getMeaningfulDirectories(filename, sourceRoot);

    if (directories.length === 0) {
        return {};
    }

    return directories.length === 1
        ? inferFromCombinedFolder(directories[0])
        : inferFromNestedFolders(directories);
}
