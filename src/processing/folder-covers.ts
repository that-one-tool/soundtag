import * as path from "node:path";
import { findAudioFiles } from "../library/file.js";
import type { TrackInfo } from "../metadata/types.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import { getTagStore } from "../tags/audio-tags.js";

type CoverHolders = Map<string, string>;

export interface SharedCover {
    holder: string;
    coverData: Buffer;
}

const NO_INFO: TrackInfo = { title: "", artist: "", album: "", year: "" };

function normalizeTagValue(value: string): string {
    return value.normalize("NFC").trim().toLowerCase();
}

function getAlbumKey({ artist, album }: TrackInfo): string | null {
    const fields = [artist, album].map(normalizeTagValue);
    return fields.every(Boolean) ? fields.join("\u0000") : null;
}

async function readCoverAlbumKey(file: string): Promise<string | null> {
    const tags = await getTagStore(file).read(file);
    return tags.hasCover ? getAlbumKey(tags.info) : null;
}

async function addCoverHolder(
    holders: CoverHolders,
    file: string
): Promise<void> {
    const key = await readCoverAlbumKey(file).catch(() => null);

    if (key && !holders.has(key)) {
        holders.set(key, file);
    }
}

async function findCoverHolders(folder: string): Promise<CoverHolders> {
    const holders: CoverHolders = new Map();

    for (const file of await findAudioFiles(folder, false)) {
        await addCoverHolder(holders, file);
    }

    return holders;
}

async function readSharedCover(holder: string): Promise<SharedCover | null> {
    const coverData = await getTagStore(holder).readCover(holder);
    return coverData ? { holder, coverData } : null;
}

// A failed read is dropped from the cache so the next track can retry it.
function getCached<Value>(
    cache: Map<string, Promise<Value>>,
    key: string,
    load: (key: string) => Promise<Value>
): Promise<Value> {
    const cached = cache.get(key);

    if (cached) {
        return cached;
    }

    const loading = load(key);
    cache.set(key, loading);
    loading.catch(() => cache.delete(key));
    return loading;
}

// Folders are scanned once per batch, after every track had its chance at a provider cover.
export class FolderCovers {
    private readonly holdersByFolder = new Map<string, Promise<CoverHolders>>();
    private readonly coversByHolder = new Map<
        string,
        Promise<SharedCover | null>
    >();

    async find(source: string, info: TrackInfo): Promise<SharedCover | null> {
        const key = getAlbumKey(info);

        if (!key) {
            return null;
        }

        const holder = (await this.getHolders(path.dirname(source))).get(key);
        return holder ? this.getCover(holder) : null;
    }

    private getHolders(folder: string): Promise<CoverHolders> {
        return getCached(this.holdersByFolder, folder, findCoverHolders);
    }

    private getCover(holder: string): Promise<SharedCover | null> {
        return getCached(this.coversByHolder, holder, readSharedCover);
    }
}

export interface CoverSharing {
    folderCovers: FolderCovers;
    sourceRoot: string;
    logger: Logger;
}

async function findMissingCover(
    source: string,
    folderCovers: FolderCovers
): Promise<SharedCover | null> {
    const tags = await getTagStore(source).read(source);
    return tags.hasCover ? null : folderCovers.find(source, tags.info);
}

function logCopiedCover(
    source: string,
    holder: string,
    { sourceRoot, logger }: CoverSharing
): void {
    const target = path.relative(sourceRoot, source);
    const origin = path.relative(sourceRoot, holder);
    logger.info(
        `\nCover copied to ${target} from ${origin} (same artist and album).`
    );
}

async function copyFolderCover(
    source: string,
    sharing: CoverSharing
): Promise<boolean> {
    const shared = await findMissingCover(source, sharing.folderCovers);

    if (!shared) {
        return false;
    }

    const { coverData, holder } = shared;
    await getTagStore(source).write(source, {
        info: NO_INFO,
        extras: {},
        coverData,
    });
    logCopiedCover(source, holder, sharing);
    return true;
}

export async function borrowFolderCover(
    source: string,
    sharing: CoverSharing
): Promise<boolean> {
    try {
        return await copyFolderCover(source, sharing);
    } catch (error) {
        sharing.logger.error(`Cover sharing error: ${getErrorMessage(error)}`);
        return false;
    }
}
