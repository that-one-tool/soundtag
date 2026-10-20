import { dirname } from "node:path";
import { isInsideFolder } from "../shared/paths.js";
import type { BrowserEntry, EntryKind, TagTarget } from "./types.js";

function isFolderTargeted(target: TagTarget, folder: string): boolean {
    if (target.kind === "file" || !target.recursive) {
        return target.path === folder;
    }

    return isInsideFolder(folder, target.path);
}

function isFileTargeted(target: TagTarget, file: string): boolean {
    if (target.kind === "file") {
        return target.path === file;
    }

    return isFolderTargeted(target, dirname(file));
}

const ENTRY_TARGETING: Record<
    EntryKind,
    (target: TagTarget, entryPath: string) => boolean
> = {
    file: isFileTargeted,
    folder: (target, folder) =>
        isInsideFolder(target.path, folder) || isFolderTargeted(target, folder),
    parent: () => false,
};

export function isEntryTargeted(
    target: TagTarget,
    entry: BrowserEntry
): boolean {
    return ENTRY_TARGETING[entry.kind](target, entry.path);
}
