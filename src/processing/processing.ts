import * as path from "node:path";
import { getTagStore, isProperlyTagged } from "../tags/audio-tags.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import { inferFolderSearchTerms } from "../library/folder-context.js";
import type { MetadataChain } from "../metadata/metadata-chain.js";
import type { TrackCorrector } from "../metadata/track-corrector.js";
import {
    EMPTY_TRACK_INFO,
    fillMissingFields,
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
import type { StoredTags } from "../tags/types.js";
import { normalizeTagValue } from "./album-tags.js";
import { hasSuspectTags, hasSuspectTitle } from "./suspect-tags.js";
import {
    correctTags,
    getCorrectedMetadata,
    type CorrectedTags,
} from "./tag-corrections.js";
import type { TrackResult, TrackStatus } from "./types.js";

export interface ProcessingContext {
    sourceRoot: string;
    metadataChain: MetadataChain;
    logger: Logger;
    // Only set in fix mode.
    corrector?: TrackCorrector;
}

interface FoundMetadata {
    metadata: TrackMetadata;
    hasExistingCover: boolean;
}

interface TrackLookup {
    source: string;
    existing: ExistingTags;
}

const SEARCH_FIELDS: readonly (keyof TrackSearch)[] = [
    "title",
    "artist",
    "album",
];

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

function isSameSearch(first: TrackSearch, second: TrackSearch): boolean {
    return SEARCH_FIELDS.every(
        (field) =>
            normalizeTagValue(first[field]) === normalizeTagValue(second[field])
    );
}

function getKeptInfo(info: TrackInfo): TrackInfo {
    return hasSuspectTitle(info) ? { ...info, title: "" } : info;
}

// Only a suspect title gives way; other existing values still win.
function keepExistingInfo(
    metadata: TrackMetadata,
    { info }: ExistingTags
): TrackMetadata {
    const merged = fillMissingFields(getKeptInfo(info), metadata.info);
    return { ...metadata, info: merged };
}

function shouldSearchFileName(
    fileSearch: TrackSearch,
    tagSearch: TrackSearch,
    { info }: ExistingTags
): boolean {
    return hasSuspectTags(info) && !isSameSearch(fileSearch, tagSearch);
}

// Wrong tags (an artist inside the title) also spoil the search they lead.
async function findFromFileName(
    { source, existing }: TrackLookup,
    tagSearch: TrackSearch,
    { sourceRoot, metadataChain, logger }: ProcessingContext
): Promise<TrackMetadata | null> {
    const search = buildTrackSearch(source, sourceRoot, EMPTY_TRACK_INFO);

    if (!shouldSearchFileName(search, tagSearch, existing)) {
        return null;
    }

    logger.info(
        "Not found with the existing tags; searching again from the file and folder names."
    );
    logSearch(search, logger);
    const found = await metadataChain.find(search, {
        ...existing,
        info: EMPTY_TRACK_INFO,
    });
    return found && keepExistingInfo(found, existing);
}

async function findTrackMetadata(
    lookup: TrackLookup,
    context: ProcessingContext
): Promise<TrackMetadata | null> {
    const { source, existing } = lookup;
    const search = buildTrackSearch(source, context.sourceRoot, existing.info);
    logSearch(search, context.logger);
    const found = await context.metadataChain.find(search, existing);
    return found ?? findFromFileName(lookup, search, context);
}

function keepWritableMetadata(
    metadata: TrackMetadata | null,
    logger: Logger
): TrackMetadata | null {
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

function getNewMetadata(
    existing: ExistingTags,
    metadata: TrackMetadata
): TrackMetadata | null {
    const extras = getNewExtras(existing.extras, metadata.extras);
    return addsMetadata(existing, metadata, extras)
        ? { ...metadata, extras }
        : null;
}

function getMetadataToWrite(
    track: CorrectedTags,
    metadata: TrackMetadata
): TrackMetadata | null {
    return getNewMetadata(track.tags, metadata) ?? getCorrectedMetadata(track);
}

interface FoundTrack {
    track: CorrectedTags;
    found: TrackMetadata | null;
}

async function tagFoundTrack(
    source: string,
    { track, found }: FoundTrack,
    { logger }: ProcessingContext
): Promise<TrackStatus> {
    const metadata = keepWritableMetadata(found, logger);

    if (!metadata) {
        return "SKIPPED";
    }

    const hasExistingCover = track.tags.hasCover;
    logMissingFields({ metadata, hasExistingCover }, logger);
    return writeNewMetadata(
        source,
        getMetadataToWrite(track, metadata),
        logger
    );
}

function isWritable(found: TrackMetadata | null): boolean {
    return found !== null && hasTitleAndArtist(found);
}

// Corrections are still written when the services find nothing usable.
async function tagUntaggedTrack(
    source: string,
    track: CorrectedTags,
    context: ProcessingContext
): Promise<TrackStatus> {
    const lookup = { source, existing: track.tags };
    const found = await findTrackMetadata(lookup, context);
    const corrected = getCorrectedMetadata(track);
    return isWritable(found) || !corrected
        ? tagFoundTrack(source, { track, found }, context)
        : writeNewMetadata(source, corrected, context.logger);
}

async function keepProperTags(
    source: string,
    track: CorrectedTags,
    logger: Logger
): Promise<TrackStatus> {
    const corrected = getCorrectedMetadata(track);

    if (corrected) {
        return writeNewMetadata(source, corrected, logger);
    }

    logger.info("Already properly tagged. Skipping.");
    return "SKIPPED";
}

function tagCorrectedTrack(
    source: string,
    track: CorrectedTags,
    context: ProcessingContext
): Promise<TrackStatus> {
    return isProperlyTagged(track.tags)
        ? keepProperTags(source, track, context.logger)
        : tagUntaggedTrack(source, track, context);
}

function readCorrectedTags(
    source: string,
    stored: StoredTags,
    context: ProcessingContext
): Promise<CorrectedTags> {
    const search = buildTrackSearch(source, context.sourceRoot, stored.info);
    return correctTags(stored, search, context);
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

async function readWrittenTags(
    source: string,
    logger: Logger
): Promise<StoredTags | null> {
    try {
        return await getTagStore(source).read(source);
    } catch (error) {
        logger.error(
            `Could not read the written tags: ${getErrorMessage(error)}`
        );
        return null;
    }
}

async function tagTrack(
    source: string,
    context: ProcessingContext
): Promise<TrackResult> {
    context.logger.info("Reading existing tags...");
    const storedTags = await getTagStore(source).read(source);
    const track = await readCorrectedTags(source, storedTags, context);
    const status = await tagCorrectedTrack(source, track, context);
    // Only a write changes the tags, so other tracks keep the ones already read.
    const tags =
        status === "TAGGED"
            ? await readWrittenTags(source, context.logger)
            : storedTags;
    return { status, tags, corrections: track.corrections };
}

export async function processTrack(
    source: string,
    context: ProcessingContext
): Promise<TrackResult> {
    try {
        return await tagTrack(source, context);
    } catch (error) {
        context.logger.error(`Processing error: ${getErrorMessage(error)}`);
        return { status: "FAILED", tags: null, corrections: [] };
    }
}
