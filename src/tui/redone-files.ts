import { movePath, type PathMove } from "../shared/paths.js";
import { Listeners } from "./listeners.js";

// Files the running job has processed, so the browser can tell them from those still queued.
export class RedoneFiles {
    private readonly listeners = new Listeners();
    private files: ReadonlySet<string> = new Set();

    subscribe = (listener: () => void): (() => void) =>
        this.listeners.add(listener);

    getSnapshot = (): ReadonlySet<string> => this.files;

    add(file: string): void {
        if (this.files.has(file)) {
            return;
        }

        this.update(new Set([...this.files, file]));
    }

    recordMove(move: PathMove): void {
        this.update(
            new Set([...this.files].map((file) => movePath(file, move)))
        );
    }

    clear(): void {
        if (this.files.size > 0) {
            this.update(new Set());
        }
    }

    private update(files: ReadonlySet<string>): void {
        this.files = files;
        this.listeners.notify();
    }
}
