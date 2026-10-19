import * as path from "node:path";
import { findAudioFiles, listSubfolders } from "../library/file.js";
import { getErrorMessage } from "../shared/errors.js";
import type { BrowserEntry, BrowserListing, EntryKind } from "./types.js";

function getParentEntries(directory: string): BrowserEntry[] {
    const parent = path.dirname(directory);
    return parent === directory
        ? []
        : [{ name: "..", path: parent, kind: "parent" }];
}

function createEntry(entryPath: string, kind: EntryKind): BrowserEntry {
    return { name: path.basename(entryPath), path: entryPath, kind };
}

async function readChildEntries(directory: string): Promise<BrowserEntry[]> {
    const [subfolders, audioFiles] = await Promise.all([
        listSubfolders(directory),
        findAudioFiles(directory, false),
    ]);
    return [
        ...subfolders.map((name) =>
            createEntry(path.join(directory, name), "folder")
        ),
        ...audioFiles.map((file) => createEntry(file, "file")),
    ];
}

export async function readBrowserEntries(
    directory: string
): Promise<BrowserListing> {
    const parentEntries = getParentEntries(directory);

    try {
        const children = await readChildEntries(directory);
        return { entries: [...parentEntries, ...children] };
    } catch (error) {
        return { entries: parentEntries, error: getErrorMessage(error) };
    }
}
