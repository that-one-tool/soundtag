import * as path from "node:path";
import { findAudioFiles, listSubfolders } from "../library/file.js";
import { getErrorMessage } from "../shared/errors.js";
import { getTagStore } from "../tags/audio-tags.js";
import type { BrowserEntry, EntryDetails } from "./types.js";

async function readFileDetails(file: string): Promise<EntryDetails> {
    return {
        kind: "file",
        format: path.extname(file).slice(1).toUpperCase(),
        tags: await getTagStore(file).read(file),
    };
}

async function readFolderDetails(folder: string): Promise<EntryDetails> {
    const [audioFiles, subfolders] = await Promise.all([
        findAudioFiles(folder, false),
        listSubfolders(folder),
    ]);
    return {
        kind: "folder",
        audioFileCount: audioFiles.length,
        subfolderCount: subfolders.length,
    };
}

const DETAIL_READERS: Record<
    BrowserEntry["kind"],
    (entryPath: string) => Promise<EntryDetails>
> = {
    file: readFileDetails,
    folder: readFolderDetails,
    parent: async () => ({ kind: "parent" }),
};

export async function readEntryDetails(
    entry: BrowserEntry
): Promise<EntryDetails> {
    try {
        return await DETAIL_READERS[entry.kind](entry.path);
    } catch (error) {
        return { kind: "unreadable", message: getErrorMessage(error) };
    }
}
