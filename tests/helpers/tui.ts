import { createCoverCache } from "../../src/tui/cover-reader.js";
import { createDetailsCache } from "../../src/tui/entry-details.js";
import { EntryRenamer } from "../../src/tui/entry-renamer.js";
import { LogBuffer } from "../../src/tui/log-buffer.js";
import { PathMoves } from "../../src/tui/path-moves.js";
import { TaggingQueue } from "../../src/tui/tagging-queue.js";
import { SubfolderSetting } from "../../src/tui/subfolder-setting.js";
import { TrackStatusStore } from "../../src/tui/track-status-store.js";
import type { TuiServices } from "../../src/tui/tui-services.js";
import type { TagTarget } from "../../src/tui/types.js";

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
    return {
        services: {
            queue,
            logBuffer,
            statusStore: new TrackStatusStore(),
            pathMoves,
            subfolders: new SubfolderSetting(true),
            detailsCache: createDetailsCache(),
            coverCache: createCoverCache({ trueColor: true }),
            renamer: new EntryRenamer({ queue, pathMoves, logger: logBuffer }),
        },
        jobs,
    };
}
