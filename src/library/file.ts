import { randomUUID } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isSameFilename, type FolderNameCache } from "./folder-names.js";

const AUDIO_FORMATS = ["mp3", "ogg", "flac", "wav"] as const;

export type AudioFormat = (typeof AUDIO_FORMATS)[number];

interface AudioFileSearch {
    recursive: boolean;
    maxFiles: number;
    files: string[];
}

function isAudioFormat(extension: string): extension is AudioFormat {
    return (AUDIO_FORMATS as readonly string[]).includes(extension);
}

export function getAudioFormat(filename: string): AudioFormat | null {
    const extension = path.extname(filename).slice(1).toLowerCase();
    return isAudioFormat(extension) ? extension : null;
}

export async function isDirectory(directory: string): Promise<boolean> {
    const stats = await fs.stat(directory).catch(() => null);
    return Boolean(stats?.isDirectory());
}

function isSearchFull(search: AudioFileSearch): boolean {
    return search.files.length >= search.maxFiles;
}

function isHidden(entry: Dirent): boolean {
    return entry.name.startsWith(".");
}

function isVisibleDirectory(entry: Dirent): boolean {
    return entry.isDirectory() && !isHidden(entry);
}

function isWalkableDirectory(entry: Dirent, search: AudioFileSearch): boolean {
    return search.recursive && isVisibleDirectory(entry);
}

function isVisibleFile(entry: Dirent): boolean {
    return entry.isFile() && !isHidden(entry);
}

function isAudioFile(entry: Dirent): boolean {
    return isVisibleFile(entry) && getAudioFormat(entry.name) !== null;
}

async function collectEntry(
    entry: Dirent,
    fullPath: string,
    search: AudioFileSearch
): Promise<void> {
    if (isWalkableDirectory(entry, search)) {
        return collectAudioFiles(fullPath, search);
    }

    if (isAudioFile(entry)) {
        search.files.push(fullPath);
    }
}

async function collectAudioFiles(
    directory: string,
    search: AudioFileSearch
): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    for (const entry of entries) {
        if (isSearchFull(search)) {
            return;
        }

        await collectEntry(entry, path.join(directory, entry.name), search);
    }
}

export async function findAudioFiles(
    directory: string,
    recursive = true,
    maxFiles = Number.POSITIVE_INFINITY
): Promise<string[]> {
    const search: AudioFileSearch = { recursive, maxFiles, files: [] };
    await collectAudioFiles(directory, search);
    return search.files.toSorted((first, second) =>
        first.localeCompare(second)
    );
}

async function isVisibleFolderOrLink(
    entry: Dirent,
    directory: string
): Promise<boolean> {
    if (!entry.isSymbolicLink()) {
        return isVisibleDirectory(entry);
    }

    return !isHidden(entry) && isDirectory(path.join(directory, entry.name));
}

export async function listSubfolders(directory: string): Promise<string[]> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const folderFlags = await Promise.all(
        entries.map((entry) => isVisibleFolderOrLink(entry, directory))
    );
    return entries
        .filter((_entry, index) => folderFlags[index])
        .map((entry) => entry.name)
        .toSorted((first, second) => first.localeCompare(second));
}

export async function renameIfFree(
    source: string,
    destination: string,
    folderNames: FolderNameCache
): Promise<boolean> {
    if (await folderNames.isTaken(destination)) {
        return false;
    }

    await fs.rename(source, destination);
    folderNames.recordRename(source, destination);
    return true;
}

// The source itself is skipped so that a case-only rename stays allowed.
async function hasNameTwin(
    source: string,
    destination: string
): Promise<boolean> {
    const sourceName = path.basename(source);
    const names = await fs.readdir(path.dirname(destination));
    return names.some(
        (name) =>
            name !== sourceName &&
            isSameFilename(name, path.basename(destination))
    );
}

export async function renameIfNameFree(
    source: string,
    destination: string
): Promise<boolean> {
    if (await hasNameTwin(source, destination)) {
        return false;
    }

    await fs.rename(source, destination);
    return true;
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
