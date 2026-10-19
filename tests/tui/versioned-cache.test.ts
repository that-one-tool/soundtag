import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { createDetailsCache } from "../../src/tui/entry-details.js";
import { VersionedCache } from "../../src/tui/versioned-cache.js";
import type { BrowserEntry, EntryDetails } from "../../src/tui/types.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-versioned-cache-test-"
);

async function createFile(
    name: string,
    content = "audio"
): Promise<BrowserEntry> {
    const directory = await createTemporaryDirectory();
    const file = path.join(directory, name);
    await fs.writeFile(file, content);
    return { name, path: file, kind: "file" };
}

function createUnreadableCache() {
    const reads: string[] = [];
    const cache = createDetailsCache(async (entry): Promise<EntryDetails> => {
        reads.push(entry.name);
        return { kind: "unreadable", message: `read ${reads.length}` };
    });
    return { cache, reads };
}

function createFolderCache(capacity?: number) {
    const reads: string[] = [];
    const cache = new VersionedCache(
        async (entry): Promise<EntryDetails> => {
            reads.push(entry.name);
            return {
                kind: "folder",
                audioFileCount: reads.length,
                subfolderCount: 0,
            };
        },
        { capacity }
    );
    return { cache, reads };
}

test("VersionedCache keeps the details of an unchanged entry", async () => {
    const { cache, reads } = createFolderCache();
    const entry = await createFile("a.mp3");

    const details = await cache.read(entry);

    assert.equal(cache.peek(entry), details);
    assert.equal(await cache.read(entry), details);
    assert.deepEqual(reads, ["a.mp3"]);
});

test("VersionedCache reads an entry again once it changed on disk", async () => {
    const { cache, reads } = createFolderCache();
    const entry = await createFile("a.mp3");
    const first = await cache.read(entry);

    await fs.writeFile(entry.path, "rewritten audio");
    const second = await cache.read(entry);

    assert.notEqual(second, first);
    assert.equal(cache.peek(entry), second);
    assert.deepEqual(reads, ["a.mp3", "a.mp3"]);
});

test("VersionedCache evicts the least recently used entry", async () => {
    const { cache } = createFolderCache(2);
    const [first, second, third] = await Promise.all(
        ["a.mp3", "b.mp3", "c.mp3"].map((name) => createFile(name))
    );
    await cache.read(first);
    await cache.read(second);
    cache.peek(first);

    await cache.read(third);

    assert.ok(cache.peek(first));
    assert.equal(cache.peek(second), undefined);
    assert.ok(cache.peek(third));
});

test("VersionedCache does not keep unreadable details", async () => {
    const { cache, reads } = createUnreadableCache();
    const entry = await createFile("a.mp3");

    await cache.read(entry);
    await cache.read(entry);

    assert.equal(cache.peek(entry), undefined);
    assert.deepEqual(reads, ["a.mp3", "a.mp3"]);
});

test("VersionedCache does not keep the details of a missing entry", async () => {
    const { cache } = createFolderCache();
    const entry: BrowserEntry = {
        name: "gone.mp3",
        path: "/nowhere/gone.mp3",
        kind: "file",
    };

    await cache.read(entry);

    assert.equal(cache.peek(entry), undefined);
});

test("VersionedCache reads a file replaced with the same size and time", async () => {
    const { cache, reads } = createFolderCache();
    const entry = await createFile("a.mp3", "old audio");
    const sameTime = new Date("2024-01-01T00:00:00Z");
    await fs.utimes(entry.path, sameTime, sameTime);
    await cache.read(entry);

    const replacement = `${entry.path}.new`;
    await fs.writeFile(replacement, "new audio");
    await fs.utimes(replacement, sameTime, sameTime);
    await fs.rename(replacement, entry.path);
    await cache.read(entry);

    assert.deepEqual(reads, ["a.mp3", "a.mp3"]);
});

test("VersionedCache forgets an entry that became unreadable", async () => {
    let readable = true;
    const cache = createDetailsCache(async (): Promise<EntryDetails> =>
        readable ? { kind: "parent" } : { kind: "unreadable", message: "EBUSY" }
    );
    const entry = await createFile("a.mp3");
    await cache.read(entry);

    readable = false;
    await fs.writeFile(entry.path, "locked audio");
    await cache.read(entry);

    assert.equal(cache.peek(entry), undefined);
});

test("VersionedCache keeps the details of the latest read", async () => {
    const pending: ((details: EntryDetails) => void)[] = [];
    const cache = new VersionedCache(
        () => new Promise<EntryDetails>((resolve) => pending.push(resolve))
    );
    const entry = await createFile("a.mp3");
    const olderRead = cache.read(entry);
    const newerRead = cache.read(entry);
    await waitForReads(pending, 2);

    pending[1]({ kind: "folder", audioFileCount: 2, subfolderCount: 0 });
    await newerRead;
    pending[0]({ kind: "folder", audioFileCount: 1, subfolderCount: 0 });
    await olderRead;

    assert.deepEqual(cache.peek(entry), {
        kind: "folder",
        audioFileCount: 2,
        subfolderCount: 0,
    });
});

async function waitForReads(pending: unknown[], count: number): Promise<void> {
    while (pending.length < count) {
        await new Promise((resolve) => setImmediate(resolve));
    }
}

test("VersionedCache keeps a null value", async () => {
    const reads: string[] = [];
    const cache = new VersionedCache(async (entry) => {
        reads.push(entry.name);
        return null;
    });
    const entry = await createFile("a.mp3");

    await cache.read(entry);

    assert.equal(cache.peek(entry), null);
    assert.equal(await cache.read(entry), null);
    assert.deepEqual(reads, ["a.mp3"]);
});
