import * as path from "node:path";
import { renameIfFree } from "../library/file.js";
import {
    isSameFilename,
    type FolderNameCache,
} from "../library/folder-names.js";
import { buildTrackFilename } from "../library/track-filename.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import { formatLogLine } from "../shared/lookup-log.js";
import { hasCoreTags } from "../tags/audio-tags.js";
import type { StoredTags } from "../tags/types.js";
import type { ProcessingTrack, TrackOutcome, TrackStatus } from "./types.js";

export interface RenameContext {
    folderNames: FolderNameCache;
    logger: Logger;
}

function hasArtistAndTitle({ info }: StoredTags): boolean {
    return [info.artist, info.title].every((field) => field.trim());
}

// Tags no service matched, such as a covers-only write, are trusted only once fully tagged.
const RENAME_CONDITIONS: Partial<
    Record<TrackStatus, (tags: StoredTags) => boolean>
> = {
    TAGGED: hasArtistAndTitle,
    SKIPPED: hasCoreTags,
};

function getTrustedStatus({ status, songFound }: TrackOutcome): TrackStatus {
    return songFound ? status : "SKIPPED";
}

export function isRenamable(
    track: TrackOutcome
): track is TrackOutcome & { tags: StoredTags } {
    const canRename = RENAME_CONDITIONS[getTrustedStatus(track)];
    return Boolean(track.tags && canRename?.(track.tags));
}

function getTargetFilename(track: ProcessingTrack): string | null {
    if (!isRenamable(track)) {
        return null;
    }

    const { source, tags } = track;
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
        logger.info(
            formatLogLine("rename", `skipped: ${filename} already exists`)
        );
        return null;
    }

    logger.info(formatLogLine("rename", filename));
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
