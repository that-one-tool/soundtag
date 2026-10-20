import * as path from "node:path";
import { createNameField, type NameField } from "./name-field.js";
import type { BrowserEntry, EntryKind } from "./types.js";

export interface RenameDraft {
    entry: BrowserEntry;
    extension: string;
    field: NameField;
}

// Keeping the extension fixed means a rename cannot change the audio format.
const EXTENSION_GETTERS: Record<
    Exclude<EntryKind, "parent">,
    (name: string) => string
> = {
    file: (name) => path.extname(name),
    folder: () => "",
};

export function startRenameDraft(
    entry: BrowserEntry | undefined
): RenameDraft | null {
    if (!entry || entry.kind === "parent") {
        return null;
    }

    const extension = EXTENSION_GETTERS[entry.kind](entry.name);
    const stem = entry.name.slice(0, entry.name.length - extension.length);
    return { entry, extension, field: createNameField(stem) };
}

export function getDraftName({ field, extension }: RenameDraft): string {
    return field.text + extension;
}
