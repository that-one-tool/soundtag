import * as path from "node:path";
import { cleanFolderAlbum, isSameFolderName } from "./library-path.js";
import { splitLabel } from "./track-name-parser.js";
import type { AlbumFolder, AlbumTrack, AlbumUnit, TrackPlan } from "./types.js";

export type AlbumFileLister = (folder: string) => Promise<string[]>;

// "CD1", "Disc 2", "CD1 - Bonus".
const DISC_FOLDER = /^(?:cd|disc|disk)[\s._-]*(\d+)\b/iu;
// "Album - CD2", "Album – CD2", "Album (Disc 2)".
const DISC_SUFFIX = /\s*(?:[-–]\s*|\()(?:cd|disc|disk)[\s._-]*(\d+)\)?$/iu;
const BRACKET_NOTES = /(?:\s*\[[^\]]*\])+$/u;

function readDisc(name: string, pattern: RegExp): number | null {
    const disc = Number(pattern.exec(name)?.[1]);
    return disc > 0 ? disc : null;
}

function readDiscFolder(file: string): number | null {
    return readDisc(path.basename(path.dirname(file)), DISC_FOLDER);
}

function isDiscFolder(file: string): boolean {
    return DISC_FOLDER.test(path.basename(path.dirname(file)));
}

function getAlbumFolderPath(file: string): string {
    const folder = path.dirname(file);
    return isDiscFolder(file) ? path.dirname(folder) : folder;
}

function readAlbumName(folder: string): string {
    return splitLabel(path.basename(folder))[1].replace(BRACKET_NOTES, "");
}

function readAlbumLabel(folder: string): [string, string] {
    const [artist] = splitLabel(path.basename(folder));
    const album = readAlbumName(folder).replace(DISC_SUFFIX, "");
    const isDiscName = DISC_FOLDER.test(album);
    return [artist.trim(), isDiscName ? "" : cleanFolderAlbum(album)];
}

function isBelowArtist(folder: string, artist: string): boolean {
    const parent = path.basename(path.dirname(folder));
    return artist !== "" && isSameFolderName(parent, artist);
}

// A disc folder inside the album wins over a disc note on the album folder.
function readTrackDisc(file: string, folder: string): number | null {
    return readDiscFolder(file) ?? readDisc(readAlbumName(folder), DISC_SUFFIX);
}

export function findAlbumFolder(file: string): AlbumFolder | null {
    const resolved = path.resolve(file);
    const folder = getAlbumFolderPath(resolved);
    const [artist, album] = readAlbumLabel(folder);
    const isAlbum = Boolean(album) && isBelowArtist(folder, artist);
    return isAlbum
        ? { folder, artist, album, disc: readTrackDisc(resolved, folder) }
        : null;
}

// The album a folder belongs to: itself, or the album above its disc folder.
export function findFolderAlbum(folder: string): string | null {
    return findAlbumFolder(path.join(folder, "track"))?.folder ?? null;
}

// A file may bring in its whole album, so it is searched and shown from there.
export function getFileRoot(file: string): string {
    const folder = path.dirname(file);
    return findFolderAlbum(folder) ?? folder;
}

function isInAlbum(file: string, folder: string): boolean {
    return findAlbumFolder(file)?.folder === folder;
}

// Selected files stay in, even when the listing misses them.
function mergeTracks(listed: string[], selected: string[]): AlbumTrack[] {
    const files = new Set(
        [...listed, ...selected].map((file) => path.resolve(file))
    );
    return [...files].map((file) => ({
        path: file,
        disc: findAlbumFolder(file)?.disc ?? null,
    }));
}

async function createAlbumUnit(
    { folder, artist, album }: AlbumFolder,
    selected: string[],
    listAlbumFiles: AlbumFileLister
): Promise<AlbumUnit> {
    const listed = await listAlbumFiles(folder);
    const inAlbum = listed.filter((file) => isInAlbum(file, folder));
    return { folder, artist, album, tracks: mergeTracks(inAlbum, selected) };
}

interface SelectedAlbum {
    album: AlbumFolder;
    files: string[];
}

interface GroupedFiles {
    albums: SelectedAlbum[];
    singles: string[];
}

function addFile(file: string, grouped: Map<string, SelectedAlbum>): boolean {
    const album = findAlbumFolder(file);
    if (!album) {
        return false;
    }

    const selected = grouped.get(album.folder) ?? { album, files: [] };
    grouped.set(album.folder, { album, files: [...selected.files, file] });
    return true;
}

function groupFiles(files: string[]): GroupedFiles {
    const albums = new Map<string, SelectedAlbum>();
    const singles = files.filter((file) => !addFile(file, albums));
    return { albums: [...albums.values()], singles };
}

// Any file of an album folder brings in the whole album, so its tags stay alike.
export async function planTracks(
    files: string[],
    listAlbumFiles: AlbumFileLister
): Promise<TrackPlan> {
    const { albums, singles } = groupFiles(files);
    const units: AlbumUnit[] = [];
    for (const { album, files: selected } of albums) {
        units.push(await createAlbumUnit(album, selected, listAlbumFiles));
    }
    return { albums: units, singles };
}
