import type { MetadataChain } from "../metadata/metadata-chain.js";
import { EMPTY_TRACK_INFO } from "../metadata/track-metadata.js";
import type { TrackSearch } from "../metadata/types.js";
import type { Logger } from "../shared/logger.js";
import { getTagStore } from "../tags/audio-tags.js";
import type { StoredTags } from "../tags/types.js";
import { isStoredCover } from "./stored-cover.js";
import { formatSkipLine, formatWriteLine } from "./track-log.js";
import type { TrackStatus } from "./types.js";

export interface CoverTrack {
    stored: StoredTags;
    search: TrackSearch;
    // Lazy, so files that keep their cover cost no album lookup.
    findFolderCover(): Promise<Buffer | null>;
}

export interface CoverTools {
    metadataChain: MetadataChain;
    logger: Logger;
    replaceCovers?: boolean;
}

function skipTrack(logger: Logger, reason: string): TrackStatus {
    logger.info(formatSkipLine(reason));
    return "SKIPPED";
}

function keepsCover({ stored }: CoverTrack, tools: CoverTools): boolean {
    return stored.hasCover && !tools.replaceCovers;
}

async function findServiceCover(
    { stored, search }: CoverTrack,
    { metadataChain }: CoverTools
): Promise<Buffer | null> {
    const found = await metadataChain.lookups.step({ label: "search" }, () =>
        metadataChain.find(search, stored, { replaceCover: stored.hasCover })
    );
    return found?.coverData ?? null;
}

async function findNewCover(
    source: string,
    track: CoverTrack,
    tools: CoverTools
): Promise<Buffer | null> {
    const cover =
        (await track.findFolderCover()) ??
        (await findServiceCover(track, tools));
    const isSame = await isStoredCover(source, track.stored, cover);
    return isSame ? null : cover;
}

async function writeCover(
    source: string,
    coverData: Buffer,
    logger: Logger
): Promise<TrackStatus> {
    const metadata = { info: EMPTY_TRACK_INFO, extras: {}, coverData };
    await getTagStore(source).write(source, metadata);
    const existing = EMPTY_TRACK_INFO;
    logger.info(formatWriteLine({ existing, metadata, missing: [] }));
    return "TAGGED";
}

// The album cover needs no song search, so a whole folder costs one lookup.
export async function tagCoverOnly(
    source: string,
    track: CoverTrack,
    tools: CoverTools
): Promise<TrackStatus> {
    if (keepsCover(track, tools)) {
        return skipTrack(tools.logger, "already has a cover");
    }

    const cover = await findNewCover(source, track, tools);
    return cover
        ? writeCover(source, cover, tools.logger)
        : skipTrack(tools.logger, "no new cover");
}
