import * as path from "node:path";
import { renameIfFree } from "../library/file.js";
import {
    isSameFilename,
    type FolderNameCache,
} from "../library/folder-names.js";
import { buildTrackFilename } from "../library/track-filename.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import { hasCoreTags } from "../tags/audio-tags.js";
import type { StoredTags } from "../tags/types.js";
import type { ProcessingTrack, TrackStatus } from "./types.js";

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
    SKIPPED: hasCoreTags,
};

export function isRenamable(
    status: TrackStatus,
    tags: StoredTags | null
): tags is StoredTags {
    const canRename = RENAME_CONDITIONS[status];
    return Boolean(tags && canRename?.(tags));
}

function getTargetFilename({
    source,
    status,
    tags,
}: ProcessingTrack): string | null {
    if (!isRenamable(status, tags)) {
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
    track: ProcessingTrack,
    context: RenameContext
): Promise<string | null> {
    try {
        const filename = getTargetFilename(track);
        return filename
            ? await moveToFilename(track.source, filename, context)
            : null;
    } catch (error) {
        context.logger.error(`Rename error: ${getErrorMessage(error)}`);
        return null;
    }
}
