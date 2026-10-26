import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import {
    fillMissingExtras,
    fillMissingFields,
} from "../metadata/track-metadata.js";
import type { TrackInfo, TrackMetadata } from "../metadata/types.js";
import { getTagStore } from "../tags/audio-tags.js";
import type { StoredTags, TagWrite } from "../tags/types.js";
import {
    formatSkipLine,
    formatTagsLine,
    formatWriteLine,
} from "./track-log.js";
import type { ProcessingContext, TrackStatus } from "./types.js";
import { getWritePolicy, type WritePolicy } from "./write-policy.js";

interface FoundMetadata {
    metadata: TrackMetadata;
    hasExistingCover: boolean;
}

interface PlannedWrite {
    metadata: TagWrite | null;
    existing: TrackInfo;
    missing: string[];
}

const OPTIONAL_FIELD_CHECKS: [string, (found: FoundMetadata) => boolean][] = [
    ["album", ({ metadata }) => !metadata.info.album.trim()],
    ["year", ({ metadata }) => !metadata.info.year.trim()],
    ["genre", ({ metadata }) => !metadata.extras.genre],
    ["track number", ({ metadata }) => !metadata.extras.trackNumber],
    [
        "cover art",
        ({ metadata, hasExistingCover }) =>
            !hasExistingCover && !metadata.coverData,
    ],
];

function getMissingFields(found: FoundMetadata): string[] {
    return OPTIONAL_FIELD_CHECKS.filter(([, isMissing]) =>
        isMissing(found)
    ).map(([label]) => label);
}

export interface ReadTrack {
    source: string;
    stored: StoredTags;
    policy: WritePolicy;
}

// What the file keeps counts too, so only fields missing from both are named.
function getKeptMetadata(
    stored: StoredTags,
    { info, extras, coverData }: TrackMetadata
): FoundMetadata {
    return {
        metadata: {
            info: fillMissingFields(info, stored.info),
            extras: fillMissingExtras(extras, stored.extras),
            coverData,
        },
        hasExistingCover: stored.hasCover,
    };
}

function planWrite(
    { stored, policy }: ReadTrack,
    metadata: TrackMetadata
): PlannedWrite {
    return {
        metadata: policy.getChanges(stored, metadata),
        existing: stored.info,
        missing: getMissingFields(getKeptMetadata(stored, metadata)),
    };
}

async function isStoredCover(
    { source, stored }: ReadTrack,
    coverData: Buffer
): Promise<boolean> {
    if (!stored.hasCover) {
        return false;
    }

    const storedCover = await getTagStore(source).readCover(source);
    return storedCover !== null && storedCover.equals(coverData);
}

async function dropStoredCover(
    track: ReadTrack,
    found: TrackMetadata
): Promise<TrackMetadata> {
    const { coverData } = found;
    const isSame = coverData && (await isStoredCover(track, coverData));
    return isSame ? { ...found, coverData: null } : found;
}

async function writeNewMetadata(
    source: string,
    planned: PlannedWrite,
    logger: Logger
): Promise<TrackStatus> {
    const { metadata } = planned;

    if (!metadata) {
        logger.info(formatSkipLine("nothing new"));
        return "SKIPPED";
    }

    await getTagStore(source).write(source, metadata);
    logger.info(formatWriteLine({ ...planned, metadata }));
    return "TAGGED";
}

export async function readTrack(
    source: string,
    { overwrite, logger }: ProcessingContext
): Promise<ReadTrack> {
    const stored = await getTagStore(source).read(source);
    logger.info(formatTagsLine(stored.info));
    return { source, stored, policy: getWritePolicy(overwrite === true) };
}

export async function writeFoundMetadata(
    track: ReadTrack,
    found: TrackMetadata,
    logger: Logger
): Promise<TrackStatus> {
    const metadata = await dropStoredCover(track, found);
    return writeNewMetadata(track.source, planWrite(track, metadata), logger);
}

export async function failOnError(
    work: () => Promise<TrackStatus>,
    logger: Logger
): Promise<TrackStatus> {
    try {
        return await work();
    } catch (error) {
        logger.error(`Processing error: ${getErrorMessage(error)}`);
        return "FAILED";
    }
}
