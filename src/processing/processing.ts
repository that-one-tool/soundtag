import * as path from "node:path";
import { getTagStore, isProperlyTagged } from "../tags/audio-tags.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import { inferFolderSearchTerms } from "../library/folder-context.js";
import type { MetadataChain } from "../metadata/metadata-chain.js";
import {
    getFirstFilled,
    getNewExtras,
    hasNewFields,
} from "../metadata/track-metadata.js";
import { parseTrackFilename } from "../library/track-name-parser.js";
import type {
    ExistingTags,
    TrackExtras,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../metadata/types.js";
import type { TrackStatus } from "./types.js";

export interface ProcessingContext {
    sourceRoot: string;
    metadataChain: MetadataChain;
    logger: Logger;
}

interface FoundMetadata {
    metadata: TrackMetadata;
    hasExistingCover: boolean;
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

export function buildTrackSearch(
    source: string,
    sourceRoot: string,
    existingInfo: TrackInfo
): TrackSearch {
    const filenameTerms = parseTrackFilename(path.basename(source));
    const folderTerms = inferFolderSearchTerms(source, sourceRoot);

    return {
        title: getFirstFilled(existingInfo.title, filenameTerms.title),
        artist: getFirstFilled(
            existingInfo.artist,
            filenameTerms.artist,
            folderTerms.artist
        ),
        album: getFirstFilled(existingInfo.album, folderTerms.album),
    };
}

function formatSearchDetail(label: string, value: string): string {
    return value ? ` (${label}: "${value}")` : "";
}

function logSearch(
    { title, artist, album }: TrackSearch,
    logger: Logger
): void {
    logger.info(
        `Searching: "${title}"${formatSearchDetail("artist", artist)}${formatSearchDetail("album", album)}`
    );
}

function hasTitleAndArtist({ info }: TrackMetadata): boolean {
    return [info.title, info.artist].every((field) => field.trim());
}

async function findWritableMetadata(
    search: TrackSearch,
    existing: ExistingTags,
    { metadataChain, logger }: ProcessingContext
): Promise<TrackMetadata | null> {
    const metadata = await metadataChain.find(search, existing);

    if (!metadata) {
        logger.info(
            "Track not found on available metadata services. Leaving source unchanged."
        );
        return null;
    }

    if (!hasTitleAndArtist(metadata)) {
        logger.info(
            "Track title or artist is missing. Leaving source unchanged."
        );
        return null;
    }

    return metadata;
}

function logMissingFields(found: FoundMetadata, logger: Logger): void {
    const missingFields = OPTIONAL_FIELD_CHECKS.filter(([, isMissing]) =>
        isMissing(found)
    ).map(([label]) => label);

    if (missingFields.length > 0) {
        logger.info(
            `Some metadata was unavailable (${missingFields.join(", ")}); saving the fields that were found.`
        );
    }
}

function addsMetadata(
    existing: ExistingTags,
    { info, coverData }: TrackMetadata,
    newExtras: TrackExtras
): boolean {
    const hasNewExtras = Object.keys(newExtras).length > 0;
    return (
        hasNewFields(existing.info, info) || hasNewExtras || Boolean(coverData)
    );
}

function getMetadataToWrite(
    existing: ExistingTags,
    metadata: TrackMetadata
): TrackMetadata | null {
    const extras = getNewExtras(existing.extras, metadata.extras);
    return addsMetadata(existing, metadata, extras)
        ? { ...metadata, extras }
        : null;
}

async function tagUntaggedTrack(
    source: string,
    existing: ExistingTags,
    context: ProcessingContext
): Promise<TrackStatus> {
    const { sourceRoot, logger } = context;
    const search = buildTrackSearch(source, sourceRoot, existing.info);
    logSearch(search, logger);
    const metadata = await findWritableMetadata(search, existing, context);

    if (!metadata) {
        return "SKIPPED";
    }

    logMissingFields({ metadata, hasExistingCover: existing.hasCover }, logger);
    return writeNewMetadata(
        source,
        getMetadataToWrite(existing, metadata),
        logger
    );
}

async function writeNewMetadata(
    source: string,
    metadata: TrackMetadata | null,
    logger: Logger
): Promise<TrackStatus> {
    if (!metadata) {
        logger.info("No new metadata found. Leaving source unchanged.");
        return "SKIPPED";
    }

    logger.info("Writing tags...");
    await getTagStore(source).write(source, metadata);
    logger.info("Successfully tagged source file.");
    return "TAGGED";
}

async function tagTrack(
    source: string,
    context: ProcessingContext
): Promise<TrackStatus> {
    context.logger.info("Reading existing tags...");
    const storedTags = await getTagStore(source).read(source);

    if (isProperlyTagged(storedTags)) {
        context.logger.info("Already properly tagged. Skipping.");
        return "SKIPPED";
    }

    return tagUntaggedTrack(source, storedTags, context);
}

export async function processTrack(
    source: string,
    context: ProcessingContext
): Promise<TrackStatus> {
    try {
        return await tagTrack(source, context);
    } catch (error) {
        context.logger.error(`Processing error: ${getErrorMessage(error)}`);
        return "FAILED";
    }
}
