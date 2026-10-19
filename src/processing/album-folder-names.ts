import * as path from "node:path";
import {
    buildAlbumFolderName,
    getDiscLabel,
    getDiscNumber,
} from "../library/album-folder-name.js";
import type { Logger } from "../shared/logger.js";
import type { FolderAlbum, FolderName } from "./types.js";

function getGroupKey({ folder, key }: FolderAlbum): string {
    return `${path.dirname(folder)}\u0000${key}`;
}

function groupBySiblingAlbum(albums: FolderAlbum[]): FolderAlbum[][] {
    const groups = new Map<string, FolderAlbum[]>();
    for (const album of albums) {
        const key = getGroupKey(album);
        groups.set(key, [...(groups.get(key) ?? []), album]);
    }
    return [...groups.values()];
}

function getTagDisc({ disc }: FolderAlbum): string | null {
    return disc ? `CD${disc}` : null;
}

// A lone disc of a set is named after its tag so its siblings fit next to it later.
function shouldUseTagDisc(album: FolderAlbum, isShared: boolean): boolean {
    return isShared || album.discCount > 1;
}

function getDisc(album: FolderAlbum, isShared: boolean): string | null {
    const tagDisc = shouldUseTagDisc(album, isShared)
        ? getTagDisc(album)
        : null;
    return getDiscLabel(path.basename(album.folder)) ?? tagDisc;
}

function hasDistinctDiscs(discs: (string | null)[]): boolean {
    const labels = discs.filter((disc): disc is string => disc !== null);
    const numbers = new Set(labels.map(getDiscNumber));
    return labels.length === discs.length && numbers.size === discs.length;
}

function logAmbiguousAlbum([first, ...others]: FolderAlbum[], logger: Logger) {
    logger.info(
        `\nFolders not renamed: ${others.length + 1} folders hold ${first.artist} - ${first.album} without distinct discs.`
    );
}

function nameSiblingAlbums(group: FolderAlbum[], logger: Logger): FolderName[] {
    const isShared = group.length > 1;
    const discs = group.map((album) => getDisc(album, isShared));
    if (isShared && !hasDistinctDiscs(discs)) {
        logAmbiguousAlbum(group, logger);
        return [];
    }

    return group.map((album, index) => ({
        folder: album.folder,
        name: buildAlbumFolderName(album, discs[index]),
    }));
}

export function planAlbumFolderNames(
    albums: FolderAlbum[],
    logger: Logger
): FolderName[] {
    return groupBySiblingAlbum(albums).flatMap((group) =>
        nameSiblingAlbums(group, logger)
    );
}
