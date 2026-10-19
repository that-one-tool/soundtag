import * as path from "node:path";
import { getTagStore, isProperlyTagged } from "../tags/audio-tags.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import { inferFolderSearchTerms } from "../library/folder-context.js";
import type { MetadataChain } from "../metadata/metadata-chain.js";
import { getFirstFilled } from "../metadata/track-metadata.js";
import { parseTrackFilename } from "../library/track-name-parser.js";
import type {
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

const OPTIONAL_FIELD_CHECKS: [string, (metadata: TrackMetadata) => boolean][] =
    [
        ["album", ({ info }) => !info.album.trim()],
        ["year", ({ info }) => !info.year.trim()],
        ["cover art", ({ coverData }) => !coverData],
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
    existingInfo: TrackInfo,
    { metadataChain, logger }: ProcessingContext
): Promise<TrackMetadata | null> {
    const metadata = await metadataChain.find(search, existingInfo);

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

function logMissingFields(metadata: TrackMetadata, logger: Logger): void {
    const missingFields = OPTIONAL_FIELD_CHECKS.filter(([, isMissing]) =>
        isMissing(metadata)
    ).map(([label]) => label);

    if (missingFields.length > 0) {
        logger.info(
            `Some metadata was unavailable (${missingFields.join(", ")}); saving the fields that were found.`
        );
    }
}

async function tagUntaggedTrack(
    source: string,
    existingInfo: TrackInfo,
    context: ProcessingContext
): Promise<TrackStatus> {
    const { sourceRoot, logger } = context;
    const search = buildTrackSearch(source, sourceRoot, existingInfo);
    logSearch(search, logger);
    const metadata = await findWritableMetadata(search, existingInfo, context);

    if (!metadata) {
        return "SKIPPED";
    }

    logMissingFields(metadata, logger);
    await getTagStore(source).write(source, metadata);
    logger.info("Successfully tagged source file.");
    return "TAGGED";
}

async function tagTrack(
    source: string,
    context: ProcessingContext
): Promise<TrackStatus> {
    const storedTags = await getTagStore(source).read(source);

    if (isProperlyTagged(storedTags)) {
        context.logger.info("Already properly tagged. Skipping.");
        return "SKIPPED";
    }

    return tagUntaggedTrack(source, storedTags.info, context);
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
