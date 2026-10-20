import * as path from "node:path";
import { renameIfNameFree } from "../library/file.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import type { PathMoves } from "./path-moves.js";
import {
    getDraftName,
    startRenameDraft,
    type RenameDraft,
} from "./rename-draft.js";
import type { TaggingQueue } from "./tagging-queue.js";
import type { BrowserEntry } from "./types.js";

export interface EntryRenamerServices {
    queue: TaggingQueue;
    pathMoves: PathMoves;
    logger: Logger;
}

// The scan skips hidden entries, so a leading dot would make one vanish.
const NAME_PROBLEMS: [(draft: RenameDraft) => boolean, string][] = [
    [({ field }) => !field.text.trim(), "the name is empty"],
    [(draft) => getDraftName(draft).includes("/"), "a name cannot contain /"],
    [
        (draft) => getDraftName(draft).startsWith("."),
        "a name starting with a dot would be hidden",
    ],
];

export class EntryRenamer {
    constructor(private readonly services: EntryRenamerServices) {}

    startDraft(entry: BrowserEntry | undefined): RenameDraft | null {
        const draft = startRenameDraft(entry);
        const problem = draft && this.findBusyProblem(draft.entry);
        if (problem) {
            this.services.logger.error(`Not renamed: ${problem}.`);
            return null;
        }

        return draft;
    }

    async rename(draft: RenameDraft): Promise<void> {
        if (getDraftName(draft) === draft.entry.name) {
            return;
        }

        const problem = this.findProblem(draft);
        if (problem) {
            this.services.logger.error(`Not renamed: ${problem}.`);
            return;
        }

        await this.moveEntry(draft.entry, getDraftName(draft));
    }

    // A queued job would lose track of the files it is about to tag.
    private findBusyProblem(entry: BrowserEntry): string | undefined {
        return this.services.queue.isBusyWith(entry.path)
            ? `${entry.name} is queued for tagging`
            : undefined;
    }

    private findProblem(draft: RenameDraft): string | undefined {
        return (
            this.findBusyProblem(draft.entry) ??
            NAME_PROBLEMS.find(([hasProblem]) => hasProblem(draft))?.[1]
        );
    }

    private async moveEntry(entry: BrowserEntry, name: string): Promise<void> {
        try {
            await this.moveToFreeName(entry, name);
        } catch (error) {
            this.services.logger.error(
                `Rename error: ${getErrorMessage(error)}`
            );
        }
    }

    private async moveToFreeName(entry: BrowserEntry, name: string) {
        const { logger, pathMoves } = this.services;
        const destination = path.join(path.dirname(entry.path), name);

        if (!(await renameIfNameFree(entry.path, destination))) {
            logger.info(`Not renamed: ${name} already exists.`);
            return;
        }

        pathMoves.record({ source: entry.path, destination });
        logger.info(`Renamed ${entry.name} to ${name}.`);
    }
}
