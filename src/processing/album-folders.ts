import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
    findAudioFiles,
    listSubfolders,
    renameIfFree,
} from "../library/file.js";
import {
    isSameFilename,
    type FolderNameCache,
} from "../library/folder-names.js";
import type { TrackInfo } from "../metadata/types.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import { isInsideFolder, type PathMove } from "../shared/paths.js";
import type { StoredTags } from "../tags/types.js";
import type { FolderAlbum, FolderName } from "./types.js";
import { getAlbumKey, type KnownTags } from "./album-tags.js";

const MIN_ALBUM_TRACKS = 2;

export interface AlbumFolderRenaming {
    libraryRoot: string;
    // Only tracks whose tags are trusted enough to rename them.
    knownTags: KnownTags;
    folderNames: FolderNameCache;
    logger: Logger;
}

async function hasAudioSubfolder(folder: string): Promise<boolean> {
    for (const name of await listSubfolders(folder)) {
        const found = await findAudioFiles(path.join(folder, name), true, 1);
        if (found.length > 0) {
            return true;
        }
    }

    return false;
}

function getRealPath(folder: string): Promise<string> {
    return fs.realpath(folder).catch(() => path.resolve(folder));
}

// The library root and its parents are the user's own layout.
async function isProtected(
    folder: string,
    libraryRoot: string
): Promise<boolean> {
    const [realFolder, realRoot] = await Promise.all(
        [folder, libraryRoot].map(getRealPath)
    );
    return isInsideFolder(realRoot, realFolder);
}

async function isAlbumCandidate(
    folder: string,
    libraryRoot: string
): Promise<boolean> {
    if (await isProtected(folder, libraryRoot)) {
        return false;
    }

    return !(await hasAudioSubfolder(folder));
}

// Some taggers leave NUL terminators in the album artist.
function getAlbumArtist({ info, extras }: StoredTags): string {
    const albumArtist = (extras.albumArtist ?? "").replace(/\0+$/, "").trim();
    return albumArtist || info.artist;
}

function getAlbumInfo(tags: StoredTags): TrackInfo {
    return { ...tags.info, artist: getAlbumArtist(tags) };
}

function getSingleValue<Value>(values: Value[]): Value | null {
    return new Set(values).size === 1 ? values[0] : null;
}

function getTrustedTags(
    files: string[],
    knownTags: KnownTags
): StoredTags[] | null {
    const tags = files.map((file) => knownTags.get(file));
    const isTrusted = tags.every((track) => track !== undefined);
    return isTrusted && tags.length >= MIN_ALBUM_TRACKS ? tags : null;
}

function getDiscCount(tags: StoredTags[]): number {
    return Math.max(...tags.map(({ extras }) => extras.discCount ?? 0));
}

function describeAlbum(folder: string, tags: StoredTags[]): FolderAlbum | null {
    const albumKeys = tags.map((track) => getAlbumKey(getAlbumInfo(track)));
    const key = getSingleValue(albumKeys);
    if (!key) {
        return null;
    }

    const { artist, album } = getAlbumInfo(tags[0]);
    const discs = tags.map(({ extras }) => extras.discNumber ?? null);
    const disc = getSingleValue(discs);
    const discCount = Math.max(getDiscCount(tags), disc ?? 0);
    return { folder, artist, album, key, disc, discCount };
}

async function readFolderAlbum(
    folder: string,
    renaming: AlbumFolderRenaming
): Promise<FolderAlbum | null> {
    if (!(await isAlbumCandidate(folder, renaming.libraryRoot))) {
        return null;
    }

    const files = await findAudioFiles(folder, false);
    const tags = getTrustedTags(files, renaming.knownTags);
    return tags && describeAlbum(folder, tags);
}

function logRenameError(error: unknown, logger: Logger): null {
    logger.error(`Folder rename error: ${getErrorMessage(error)}`);
    return null;
}

export function findFolderAlbum(
    folder: string,
    renaming: AlbumFolderRenaming
): Promise<FolderAlbum | null> {
    return readFolderAlbum(folder, renaming).catch((error: unknown) =>
        logRenameError(error, renaming.logger)
    );
}

async function moveFolder(
    { folder, name }: FolderName,
    { folderNames, logger }: AlbumFolderRenaming
): Promise<PathMove | null> {
    const destination = path.join(path.dirname(folder), name);

    if (!(await renameIfFree(folder, destination, folderNames))) {
        logger.info(`\nFolder not renamed: ${name} already exists.`);
        return null;
    }

    logger.info(`\nFolder renamed: ${path.basename(folder)} → ${name}`);
    return { source: folder, destination };
}

export async function renameAlbumFolder(
    target: FolderName,
    renaming: AlbumFolderRenaming
): Promise<PathMove | null> {
    if (isSameFilename(path.basename(target.folder), target.name)) {
        return null;
    }

    return moveFolder(target, renaming).catch((error: unknown) =>
        logRenameError(error, renaming.logger)
    );
}
