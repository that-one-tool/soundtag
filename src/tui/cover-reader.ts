import { createHash } from "node:crypto";
import { getTagStore } from "../tags/audio-tags.js";
import {
    decodeToPng,
    decodeWithSharp,
    type CoverSize,
} from "./cover-decoder.js";
import type { CoverMode } from "./cover-mode.js";
import type { BrowserEntry, CoverLookup, CoverPicture } from "./types.js";
import { VersionedCache, type EntryReader } from "./versioned-cache.js";

// Half-block cells hold two pixel rows, so this fills 48 columns by 24 rows.
export const COVER_SIZE: CoverSize = { width: 48, height: 48 };

type PictureDecoder = (image: Buffer) => Promise<CoverPicture>;

const decodeHalfBlocks: PictureDecoder = (image) =>
    decodeWithSharp(image, COVER_SIZE);

// Tracks of one album share a key, so their cover is sent to the terminal once.
async function decodeKittyPng(image: Buffer): Promise<CoverPicture> {
    const png = await decodeToPng(image);
    const key = createHash("sha1").update(png).digest("hex");
    return { png, key, ...COVER_SIZE };
}

const MISSING: CoverLookup = { kind: "missing" };
const UNREADABLE: CoverLookup = { kind: "unreadable" };

// An image that cannot be decoded will not decode later either.
async function decodeCover(
    image: Buffer,
    decode: PictureDecoder
): Promise<CoverLookup> {
    try {
        return { kind: "found", art: await decode(image) };
    } catch {
        return MISSING;
    }
}

async function readFileCover(
    source: string,
    decode: PictureDecoder
): Promise<CoverLookup> {
    try {
        const image = await getTagStore(source).readCover(source);
        return image ? await decodeCover(image, decode) : MISSING;
    } catch {
        return UNREADABLE;
    }
}

export function createCoverReader(
    decode: PictureDecoder = decodeHalfBlocks
): EntryReader<CoverLookup> {
    return async (entry: BrowserEntry) =>
        entry.kind === "file" ? readFileCover(entry.path, decode) : MISSING;
}

async function readNoCover(): Promise<CoverLookup> {
    return MISSING;
}

interface CoverCacheSetup {
    createReader: () => EntryReader<CoverLookup>;
    capacity?: number;
}

// 512 pixel PNGs weigh hundreds of kilobytes, so far fewer of them are kept.
const COVER_CACHE_SETUPS: Record<CoverMode, CoverCacheSetup> = {
    kitty: {
        createReader: () => createCoverReader(decodeKittyPng),
        capacity: 50,
    },
    blocks: { createReader: () => createCoverReader() },
    none: { createReader: () => readNoCover },
};

export function createCoverCache(mode: CoverMode): VersionedCache<CoverLookup> {
    const { createReader, capacity } = COVER_CACHE_SETUPS[mode];
    return new VersionedCache(createReader(), {
        isCacheable: (lookup) => lookup.kind !== "unreadable",
        capacity,
    });
}
