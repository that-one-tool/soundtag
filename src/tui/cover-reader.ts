import { getTagStore } from "../tags/audio-tags.js";
import {
    decodeWithSharp,
    type CoverDecoder,
    type CoverSize,
} from "./cover-decoder.js";
import type { BrowserEntry, CoverLookup } from "./types.js";
import { VersionedCache, type EntryReader } from "./versioned-cache.js";

// Half-block cells hold two pixel rows, so this fills 48 columns by 24 rows.
export const COVER_SIZE: CoverSize = { width: 48, height: 48 };

const MISSING: CoverLookup = { kind: "missing" };
const UNREADABLE: CoverLookup = { kind: "unreadable" };

// An image that cannot be decoded will not decode later either.
async function decodeCover(
    image: Buffer,
    decode: CoverDecoder
): Promise<CoverLookup> {
    try {
        return { kind: "found", art: await decode(image, COVER_SIZE) };
    } catch {
        return MISSING;
    }
}

async function readFileCover(
    source: string,
    decode: CoverDecoder
): Promise<CoverLookup> {
    try {
        const image = await getTagStore(source).readCover(source);
        return image ? await decodeCover(image, decode) : MISSING;
    } catch {
        return UNREADABLE;
    }
}

export function createCoverReader(
    decode: CoverDecoder = decodeWithSharp
): EntryReader<CoverLookup> {
    return async (entry: BrowserEntry) =>
        entry.kind === "file" ? readFileCover(entry.path, decode) : MISSING;
}

async function readNoCover(): Promise<CoverLookup> {
    return MISSING;
}

export interface CoverDisplay {
    trueColor: boolean;
}

// Without true color the half blocks would draw as a plain grid.
export function createCoverCache({
    trueColor,
}: CoverDisplay): VersionedCache<CoverLookup> {
    const readCover = trueColor ? createCoverReader() : readNoCover;
    return new VersionedCache(readCover, {
        isCacheable: (lookup) => lookup.kind !== "unreadable",
    });
}
