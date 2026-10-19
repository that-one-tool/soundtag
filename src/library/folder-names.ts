import * as fs from "node:fs/promises";
import * as path from "node:path";

type Counts = Map<string, number>;

function normalizeFilename(name: string): string {
    return name.normalize("NFC").toLowerCase();
}

export function isSameFilename(first: string, second: string): boolean {
    return normalizeFilename(first) === normalizeFilename(second);
}

function getNormalizedBasename(file: string): string {
    return normalizeFilename(path.basename(file));
}

function incrementCount(counts: Counts, key: string): void {
    counts.set(key, (counts.get(key) ?? 0) + 1);
}

function decrementCount(counts: Counts, key: string): number {
    const remaining = (counts.get(key) ?? 0) - 1;

    if (remaining > 0) {
        counts.set(key, remaining);
        return remaining;
    }

    counts.delete(key);
    return 0;
}

function pathExists(file: string): Promise<boolean> {
    return fs.lstat(file).then(
        () => true,
        () => false
    );
}

// Counts per normalized name, because case or Unicode twins share one key.
export class FolderNameCache {
    private readonly namesByFolder = new Map<string, Counts>();
    private readonly pendingFilesByFolder: Counts = new Map();

    constructor(files: string[]) {
        for (const file of files) {
            incrementCount(this.pendingFilesByFolder, path.dirname(file));
        }
    }

    async isTaken(destination: string): Promise<boolean> {
        const names = await this.getNames(path.dirname(destination));

        if (names.has(getNormalizedBasename(destination))) {
            return true;
        }

        // The folder may have changed since it was read.
        return pathExists(destination);
    }

    recordRename(source: string, destination: string): void {
        this.removeName(source);
        this.addName(destination);
    }

    markProcessed(file: string): void {
        const folder = path.dirname(file);

        if (decrementCount(this.pendingFilesByFolder, folder) === 0) {
            this.namesByFolder.delete(folder);
        }
    }

    clear(): void {
        this.namesByFolder.clear();
        this.pendingFilesByFolder.clear();
    }

    private addName(file: string): void {
        const names = this.namesByFolder.get(path.dirname(file));

        if (names) {
            incrementCount(names, getNormalizedBasename(file));
        }
    }

    private removeName(file: string): void {
        const names = this.namesByFolder.get(path.dirname(file));

        if (names) {
            decrementCount(names, getNormalizedBasename(file));
        }
    }

    private async getNames(folder: string): Promise<Counts> {
        const cachedNames = this.namesByFolder.get(folder);

        if (cachedNames) {
            return cachedNames;
        }

        const names: Counts = new Map();
        for (const name of await fs.readdir(folder)) {
            incrementCount(names, normalizeFilename(name));
        }
        this.namesByFolder.set(folder, names);
        return names;
    }
}
