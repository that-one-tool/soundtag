import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import { clearAllTags } from "../tags/audio-tags.js";
import { Listeners } from "./listeners.js";
import type { TaggingQueue } from "./tagging-queue.js";
import type { TrackStatusStore } from "./track-status-store.js";
import type { BrowserEntry } from "./types.js";

export interface TagClearerServices {
    queue: TaggingQueue;
    logger: Logger;
    statusStore: TrackStatusStore;
}

function isFile(entry: BrowserEntry | undefined): entry is BrowserEntry {
    return entry?.kind === "file";
}

function isSameFile(armed: BrowserEntry, hovered: BrowserEntry | undefined) {
    return armed.path === hovered?.path;
}

// Clearing cannot be undone, so a request only arms the file until confirmed.
export class TagClearer {
    private readonly listeners = new Listeners();
    private armed: BrowserEntry | null = null;
    private clearing = false;
    private revision = 0;

    constructor(private readonly services: TagClearerServices) {}

    subscribe = (listener: () => void): (() => void) =>
        this.listeners.add(listener);

    // Bumped after each clear so the metadata panel reads the file again.
    getSnapshot = (): number => this.revision;

    isClearing(): boolean {
        return this.clearing;
    }

    isArmed(): boolean {
        return this.armed !== null;
    }

    disarm(): void {
        this.armed = null;
    }

    request(entry: BrowserEntry | undefined): void {
        if (!isFile(entry)) {
            return this.refuse("only files have tags");
        }
        if (this.services.queue.isBusyWith(entry.path)) {
            return this.refuse(`${entry.name} is queued for tagging`);
        }

        this.armed = entry;
        this.services.logger.info(
            `Press y to clear all tags of ${entry.name}.`
        );
    }

    // The cursor may land elsewhere without a key press when the listing
    // reloads, so only the hovered file is cleared.
    async confirm(hovered: BrowserEntry | undefined): Promise<void> {
        const armed = this.armed;
        this.disarm();
        if (armed && isSameFile(armed, hovered)) {
            await this.clearTags(armed);
        }
    }

    private refuse(problem: string): void {
        this.disarm();
        this.services.logger.error(`Not cleared: ${problem}.`);
    }

    private async clearTags(entry: BrowserEntry): Promise<void> {
        this.clearing = true;
        try {
            await clearAllTags(entry.path);
            this.recordCleared(entry);
        } catch (error) {
            this.services.logger.error(
                `Clear error: ${getErrorMessage(error)}`
            );
        } finally {
            this.clearing = false;
        }
    }

    private recordCleared(entry: BrowserEntry): void {
        this.services.logger.info(`Cleared all tags of ${entry.name}.`);
        this.services.statusStore.forget(entry.path);
        this.revision++;
        this.listeners.notify();
    }
}
