import * as fs from "node:fs/promises";
import type { BrowserEntry } from "./types.js";

export type EntryReader<Value> = (entry: BrowserEntry) => Promise<Value>;

export interface VersionedCacheOptions<Value> {
    isCacheable?: (value: Value) => boolean;
    capacity?: number;
}

interface ReadResult<Value> {
    value: Value;
    version: string | undefined;
    readId: number;
}

interface CachedValue<Value> extends ReadResult<Value> {
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

// A slower, older read must not replace what a newer one stored.
function isOutdated<Value>(
    stored: CachedValue<Value> | undefined,
    result: ReadResult<Value>
): boolean {
    return (stored?.readId ?? 0) > result.readId;
}

function isVersioned<Value>(
    result: ReadResult<Value>
): result is CachedValue<Value> {
    return result.version !== undefined;
}

function cacheEverything(): boolean {
    return true;
}

// Keeps what was read per entry until the entry changes on disk.
export class VersionedCache<Value> {
    private readonly cachedByKey = new Map<string, CachedValue<Value>>();
    private readCount = 0;

    constructor(
        private readonly readValue: EntryReader<Value>,
        private readonly options: VersionedCacheOptions<Value> = {}
    ) {}

    peek(entry: BrowserEntry): Value | undefined {
        return this.touch(getCacheKey(entry))?.value;
    }

    async read(entry: BrowserEntry): Promise<Value> {
        const key = getCacheKey(entry);
        const readId = ++this.readCount;
        const version = await readVersion(entry.path);
        const cached = this.touch(key);
        if (cached && cached.version === version) {
            return cached.value;
        }

        const value = await this.readValue(entry);
        this.storeResult(key, { value, version, readId });
        return value;
    }

    private touch(key: string): CachedValue<Value> | undefined {
        const cached = this.cachedByKey.get(key);
        if (cached) {
            this.store(key, cached);
        }
        return cached;
    }

    private storeResult(key: string, result: ReadResult<Value>): void {
        if (isOutdated(this.cachedByKey.get(key), result)) {
            return;
        }
        if (!this.isStorable(result)) {
            this.cachedByKey.delete(key);
            return;
        }
        this.store(key, result);
    }

    private isStorable(
        result: ReadResult<Value>
    ): result is CachedValue<Value> {
        const isCacheable = this.options.isCacheable ?? cacheEverything;
        return isVersioned(result) && isCacheable(result.value);
    }

    private store(key: string, cached: CachedValue<Value>): void {
        this.cachedByKey.delete(key);
        this.cachedByKey.set(key, cached);
        this.evictOldest();
    }

    private evictOldest(): void {
        const capacity = this.options.capacity ?? DEFAULT_CAPACITY;
        if (this.cachedByKey.size > capacity) {
            const [oldestKey] = this.cachedByKey.keys();
            this.cachedByKey.delete(oldestKey);
        }
    }
}
