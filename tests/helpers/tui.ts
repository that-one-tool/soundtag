import { CoverOverlay } from "../../src/tui/cover-overlay.js";
import { createCoverCache } from "../../src/tui/cover-reader.js";
import { createDetailsCache } from "../../src/tui/entry-details.js";
import { EntryRenamer } from "../../src/tui/entry-renamer.js";
import { LogBuffer } from "../../src/tui/log-buffer.js";
import { PathMoves } from "../../src/tui/path-moves.js";
import { TaggingQueue } from "../../src/tui/tagging-queue.js";
import { TagClearer } from "../../src/tui/tag-clearer.js";
import { ToggleSetting } from "../../src/tui/toggle-setting.js";
import { RedoneFiles } from "../../src/tui/redone-files.js";
import { TrackStatusStore } from "../../src/tui/track-status-store.js";
import type { TuiServices } from "../../src/tui/tui-services.js";
import type { TagJobSettings, TagTarget } from "../../src/tui/types.js";

export const RENAMING_ON: TagJobSettings = { renameFiles: true };

export interface ControlledJob {
    target: TagTarget;
    stopSignal: AbortSignal;
    finish(succeeded: boolean): void;
}

export function createControlledServices(): {
    services: TuiServices;
    jobs: ControlledJob[];
} {
    const jobs: ControlledJob[] = [];
    const logBuffer = new LogBuffer();
    const queue = new TaggingQueue(
        (target, stopSignal) =>
            new Promise<boolean>((resolve) =>
                jobs.push({ target, stopSignal, finish: resolve })
            ),
        logBuffer
    );
    const pathMoves = new PathMoves();
    const statusStore = new TrackStatusStore();
    return {
        services: {
            queue,
            logBuffer,
            statusStore,
            redoneFiles: new RedoneFiles(),
            pathMoves,
            subfolders: new ToggleSetting(true),
            renaming: new ToggleSetting(true),
            detailsCache: createDetailsCache(),
            coverCache: createCoverCache("blocks"),
            coverOverlay: new CoverOverlay(() => {}),
            renamer: new EntryRenamer({ queue, pathMoves, logger: logBuffer }),
            tagClearer: new TagClearer({
                queue,
                logger: logBuffer,
                statusStore,
            }),
        },
        jobs,
    };
}
