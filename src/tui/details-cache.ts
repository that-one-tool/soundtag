import * as fs from "node:fs/promises";
import { readEntryDetails } from "./entry-details.js";
import type { BrowserEntry, EntryDetails } from "./types.js";

type DetailsReader = (entry: BrowserEntry) => Promise<EntryDetails>;

interface ReadResult {
    details: EntryDetails;
    version: string | undefined;
    readId: number;
}

interface CachedDetails extends ReadResult {
    version: string;
}

const DEFAULT_CAPACITY = 500;

function getCacheKey({ kind, path }: BrowserEntry): string {
    return `${kind}:${path}`;
}

// Writes go through a renamed copy, so the inode catches rewrites that keep
// the size within the file system's time resolution.
async function readVersion(source: string): Promise<string | undefined> {
    try {
        const { ino, mtimeMs, size } = await fs.stat(source);
        return `${ino}:${mtimeMs}:${size}`;
    } catch {
        return undefined;
    }
}

function isCacheable(result: ReadResult): result is CachedDetails {
    return result.version !== undefined && result.details.kind !== "unreadable";
}

// A slower, older read must not replace what a newer one stored.
function isOutdated(
    stored: CachedDetails | undefined,
    result: ReadResult
): boolean {
    return (stored?.readId ?? 0) > result.readId;
}

export class DetailsCache {
    private readonly cachedByKey = new Map<string, CachedDetails>();
    private readCount = 0;

    constructor(
        private readonly readDetails: DetailsReader = readEntryDetails,
        private readonly capacity = DEFAULT_CAPACITY
    ) {}

    peek(entry: BrowserEntry): EntryDetails | undefined {
        return this.touch(getCacheKey(entry))?.details;
    }

    async read(entry: BrowserEntry): Promise<EntryDetails> {
        const key = getCacheKey(entry);
        const readId = ++this.readCount;
        const version = await readVersion(entry.path);
        const cached = this.touch(key);
        if (cached && cached.version === version) {
            return cached.details;
        }

        const details = await this.readDetails(entry);
        this.storeResult(key, { details, version, readId });
        return details;
    }

    private touch(key: string): CachedDetails | undefined {
        const cached = this.cachedByKey.get(key);
        if (cached) {
            this.store(key, cached);
        }
        return cached;
    }

    private storeResult(key: string, result: ReadResult): void {
        if (isOutdated(this.cachedByKey.get(key), result)) {
            return;
        }
        if (!isCacheable(result)) {
            this.cachedByKey.delete(key);
            return;
        }
        this.store(key, result);
    }

    private store(key: string, cached: CachedDetails): void {
        this.cachedByKey.delete(key);
        this.cachedByKey.set(key, cached);
        this.evictOldest();
    }

    private evictOldest(): void {
        if (this.cachedByKey.size > this.capacity) {
            const [oldestKey] = this.cachedByKey.keys();
            this.cachedByKey.delete(oldestKey);
        }
    }
}
