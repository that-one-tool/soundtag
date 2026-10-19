import * as path from "node:path";
import { renameIfFree } from "../library/file.js";
import {
    isSameFilename,
    type FolderNameCache,
} from "../library/folder-names.js";
import { buildTrackFilename } from "../library/track-filename.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import { getTagStore, isProperlyTagged } from "../tags/audio-tags.js";
import type { StoredTags } from "../tags/types.js";
import type { TrackStatus } from "./types.js";

export interface RenameContext {
    folderNames: FolderNameCache;
    logger: Logger;
}

function hasArtistAndTitle({ info }: StoredTags): boolean {
    return [info.artist, info.title].every((field) => field.trim());
}

// A skipped track that is not fully tagged was not found, so its tags are unverified.
const RENAME_CONDITIONS: Partial<
    Record<TrackStatus, (tags: StoredTags) => boolean>
> = {
    TAGGED: hasArtistAndTitle,
    SKIPPED: isProperlyTagged,
};

async function readRenamableTags(
    source: string,
    status: TrackStatus
): Promise<StoredTags | null> {
    const canRename = RENAME_CONDITIONS[status];

    if (!canRename) {
        return null;
    }

    const tags = await getTagStore(source).read(source);
    return canRename(tags) ? tags : null;
}

async function getTargetFilename(
    source: string,
    status: TrackStatus
): Promise<string | null> {
    const tags = await readRenamableTags(source, status);

    if (!tags) {
        return null;
    }

    const target = buildTrackFilename(tags.info, path.extname(source));
    return isSameFilename(path.basename(source), target) ? null : target;
}

async function moveToFilename(
    source: string,
    filename: string,
    { folderNames, logger }: RenameContext
): Promise<string | null> {
    const destination = path.join(path.dirname(source), filename);

    if (!(await renameIfFree(source, destination, folderNames))) {
        logger.info(`Not renamed: ${filename} already exists.`);
        return null;
    }

    logger.info(`Renamed to: ${filename}`);
    return destination;
}

export async function renameTrack(
    source: string,
    status: TrackStatus,
    context: RenameContext
): Promise<string | null> {
    try {
        const filename = await getTargetFilename(source, status);
        return filename
            ? await moveToFilename(source, filename, context)
            : null;
    } catch (error) {
        context.logger.error(`Rename error: ${getErrorMessage(error)}`);
        return null;
    }
}
