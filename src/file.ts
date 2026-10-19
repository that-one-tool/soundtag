import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export type AudioFormat = "mp3" | "ogg" | "flac" | "wav";

export interface TrackSearchTerms {
    title: string;
    artist?: string;
    album?: string;
}

export function getAudioFormat(filename: string): AudioFormat | null {
    const extension = path.extname(filename).slice(1).toLowerCase();

    switch (extension) {
        case "mp3":
        case "ogg":
        case "flac":
        case "wav":
            return extension;
        default:
            return null;
    }
}

function cleanFilenamePart(value: string): string {
    return value.replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
}

function removeTrackNumber(name: string): string {
    return name.replace(
        /^\s*(?:\d{1,2}[._-]\d{1,2}|\d{1,3})(?:\s*[-._]\s*|\s+)/,
        ""
    );
}

export function parseTrackFilename(filename: string): TrackSearchTerms {
    const name = removeTrackNumber(path.parse(filename).name)
        .replace(/[._]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const separator = name.match(/\s+-\s+|\s*[–—]\s*/);

    if (separator?.index !== undefined) {
        const artist = cleanFilenamePart(name.slice(0, separator.index));
        const title = cleanFilenamePart(
            name.slice(separator.index + separator[0].length)
        );

        if (artist && title) {
            return { artist, title };
        }
    }

    return { title: cleanFilenamePart(name) };
}

function isStructuralDirectory(name: string): boolean {
    const normalized = name.trim().toLowerCase();

    return (
        !normalized ||
        /^(?:(?:artist|album|artiste)\s+)?(?:unknown|inconnu|unknown artist|unknown album|artiste inconnu|album inconnu|various artists|va|miscellaneous|misc)$/.test(
            normalized
        ) ||
        /^(?:cover|covers|artwork|booklet|cd|disc|disk)(?:[\s._-]*\d+)?$/.test(
            normalized
        ) ||
        /^(?:music|musique|audio|media|library|bibliothèque|itunes music)$/.test(
            normalized
        ) ||
        /^\d{4}(?:\s*[-._]\s*\d{4})?$/.test(normalized) ||
        /^(?:part|partie|volume|vol\.?)[\s._-]*\d+$/.test(normalized)
    );
}

function cleanAlbumDirectory(name: string): string {
    return name
        .replace(/^\s*\d{4}\s*[-._]\s*/, "")
        .replace(/\s+/g, " ")
        .trim();
}

export function inferFolderSearchTerms(
    filename: string,
    sourceRoot: string
): Pick<TrackSearchTerms, "artist" | "album"> {
    const relativeDirectory = path.relative(
        path.resolve(sourceRoot),
        path.dirname(path.resolve(filename))
    );
    const directories =
        relativeDirectory === ""
            ? []
            : relativeDirectory
                  .split(path.sep)
                  .filter((directory) => !isStructuralDirectory(directory));

    if (directories.length === 0) {
        return {};
    }

    const albumDirectory = directories[directories.length - 1];
    const albumLabel = cleanAlbumDirectory(albumDirectory);

    if (directories.length === 1) {
        const separator = albumLabel.match(/\s+-\s+|\s*[–—]\s*/);
        const hasAlbumMarker =
            /\b(?:ost|soundtrack|compilation|best of|greatest hits)\b/i.test(
                albumLabel
            );

        if (separator?.index !== undefined && !hasAlbumMarker) {
            const artist = cleanFilenamePart(
                albumLabel.slice(0, separator.index)
            );
            const album = cleanAlbumDirectory(
                albumLabel.slice(separator.index + separator[0].length)
            );

            if (artist && album) {
                return { artist, album };
            }
        }

        if (!albumLabel) {
            return {};
        }

        return { album: albumLabel };
    }

    const artist = cleanFilenamePart(directories[directories.length - 2]);
    return {
        ...(artist ? { artist } : {}),
        ...(albumLabel ? { album: albumLabel } : {}),
    };
}

export async function isDirectory(directory: string): Promise<boolean> {
    const stats = await fs.stat(directory).catch(() => null);
    return Boolean(stats?.isDirectory());
}

export async function findAudioFiles(
    directory: string,
    recursive = true,
    maxFiles = Number.POSITIVE_INFINITY
): Promise<string[]> {
    const files: string[] = [];

    async function walk(currentDirectory: string): Promise<void> {
        if (files.length >= maxFiles) {
            return;
        }

        const entries = await fs.readdir(currentDirectory, {
            withFileTypes: true,
        });

        for (const entry of entries) {
            if (files.length >= maxFiles) {
                break;
            }

            const fullPath = path.join(currentDirectory, entry.name);

            if (recursive && entry.isDirectory()) {
                await walk(fullPath);
            } else if (entry.isFile() && getAudioFormat(entry.name)) {
                files.push(fullPath);
            }
        }
    }

    await walk(directory);

    return files.sort((a, b) => a.localeCompare(b));
}

export async function writeTemporaryCopy(
    source: string,
    destination: string,
    updateTemporary: (temporary: string) => Promise<void>
): Promise<void> {
    const destinationDirectory = path.dirname(destination);
    const extension = path.extname(destination);
    const temporary = path.join(
        destinationDirectory,
        `.${path.basename(destination, extension)}.${randomUUID()}${extension}`
    );

    await fs.mkdir(destinationDirectory, { recursive: true });

    try {
        await fs.copyFile(source, temporary, constants.COPYFILE_EXCL);
        await updateTemporary(temporary);
        await fs.rename(temporary, destination);
    } finally {
        await fs.rm(temporary, { force: true });
    }
}
