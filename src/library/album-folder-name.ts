import { buildArtistName } from "./track-filename.js";

// Also matches the suffix of a folder renamed earlier, so renames are stable.
const DISC_FOLDER_NAME = /(?:^|[\s([_-])((?:cd|dis[ck])[\s_-]*\d+)[)\]]?$/i;

interface AlbumName {
    artist: string;
    album: string;
}

export function getDiscLabel(folderName: string): string | null {
    const match = DISC_FOLDER_NAME.exec(folderName.trim());
    return match ? match[1].replace(/\s+/g, " ") : null;
}

export function getDiscNumber(label: string): number {
    return Number(/\d+$/.exec(label)?.[0]);
}

function isDiscOfAlbum(album: string, disc: string): boolean {
    const albumDisc = getDiscLabel(album);
    return (
        albumDisc !== null && getDiscNumber(albumDisc) === getDiscNumber(disc)
    );
}

function getDiscSuffix(album: string, disc: string | null): string {
    if (!disc || isDiscOfAlbum(album, disc)) {
        return "";
    }

    return ` - ${disc}`;
}

export function buildAlbumFolderName(
    { artist, album }: AlbumName,
    disc: string | null
): string {
    return buildArtistName(artist, album, getDiscSuffix(album.trim(), disc));
}
