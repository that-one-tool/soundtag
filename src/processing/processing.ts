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
    CorrectionRequest,
    ExistingTags,
    TrackExtras,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../metadata/types.js";
import type { StoredTags } from "../tags/types.js";
import { normalizeTagValue } from "./album-tags.js";
import { getAlternativeSearches } from "./correction-searches.js";
import {
    hasSuspectIdentity,
    hasSuspectTags,
    hasSuspectTitle,
} from "./suspect-tags.js";
import {
    correctTags,
    getCorrectedMetadata,
    type CorrectedTags,
} from "./tag-corrections.js";
import {
    formatSearchSubject,
    formatSkipLine,
    formatTagsLine,
    formatWriteLine,
} from "./track-log.js";
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

interface SearchRun {
    metadataChain: MetadataChain;
    subject?: string;
}

interface PlannedWrite {
    metadata: TrackMetadata | null;
    existing: TrackInfo;
    missing: string[];
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

function searchServices(
    search: TrackSearch,
    existing: ExistingTags,
    { metadataChain, subject }: SearchRun
): Promise<TrackMetadata | null> {
    return metadataChain.lookups.step({ label: "search", subject }, () =>
        metadataChain.find(search, existing)
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

// Terms taken from the file or folder names are worth showing.
function getSearchSubject(
    search: TrackSearch,
    info: TrackInfo
): string | undefined {
    return isSameSearch(search, info) ? undefined : formatSearchSubject(search);
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
    { sourceRoot, metadataChain }: ProcessingContext
): Promise<TrackMetadata | null> {
    const search = buildTrackSearch(source, sourceRoot, EMPTY_TRACK_INFO);

    if (!shouldSearchFileName(search, tagSearch, existing)) {
        return null;
    }

    const subject = `file name ${formatSearchSubject(search)}`;
    const withoutInfo = { ...existing, info: EMPTY_TRACK_INFO };
    const found = await searchServices(search, withoutInfo, {
        metadataChain,
        subject,
    });
    return found && keepExistingInfo(found, existing);
}

async function findTrackMetadata(
    lookup: TrackLookup,
    context: ProcessingContext
): Promise<TrackMetadata | null> {
    const { source, existing } = lookup;
    const search = buildTrackSearch(source, context.sourceRoot, existing.info);
    const { metadataChain } = context;
    const subject = getSearchSubject(search, existing.info);
    const found = await searchServices(search, existing, {
        metadataChain,
        subject,
    });
    return found ?? findFromFileName(lookup, search, context);
}

function keepWritableMetadata(
    metadata: TrackMetadata | null,
    logger: Logger
): TrackMetadata | null {
    if (!metadata) {
        logger.info(formatSkipLine("not found"));
        return null;
    }

    if (!hasTitleAndArtist(metadata)) {
        logger.info(formatSkipLine("no title or artist found"));
        return null;
    }

    return metadata;
}

function getMissingFields(found: FoundMetadata): string[] {
    return OPTIONAL_FIELD_CHECKS.filter(([, isMissing]) =>
        isMissing(found)
    ).map(([label]) => label);
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
    return writeNewMetadata(
        source,
        {
            metadata: getMetadataToWrite(track, metadata),
            existing: track.tags.info,
            missing: getMissingFields({ metadata, hasExistingCover }),
        },
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
        : writeCorrections(source, track, context.logger);
}

function writeCorrections(
    source: string,
    track: CorrectedTags,
    logger: Logger
): Promise<TrackStatus> {
    const metadata = getCorrectedMetadata(track);
    const existing = track.tags.info;
    return writeNewMetadata(
        source,
        { metadata, existing, missing: [] },
        logger
    );
}

async function keepProperTags(
    source: string,
    track: CorrectedTags,
    logger: Logger
): Promise<TrackStatus> {
    if (track.corrections.length > 0) {
        return writeCorrections(source, track, logger);
    }

    logger.info(formatSkipLine("already tagged"));
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

function buildCorrectionRequest(
    source: string,
    sourceRoot: string,
    info: TrackInfo
): CorrectionRequest {
    // Without the album, which a wrong album would make find nothing.
    const tagSearch = {
        ...buildTrackSearch(source, sourceRoot, info),
        album: "",
    };
    const fileSearch = buildTrackSearch(source, sourceRoot, EMPTY_TRACK_INFO);
    return {
        tagSearch,
        alternatives: getAlternativeSearches(info, { tagSearch, fileSearch }),
        hasSuspectTags: hasSuspectIdentity(info),
        folderAlbum: fileSearch.album,
    };
}

function readCorrectedTags(
    source: string,
    stored: StoredTags,
    context: ProcessingContext
): Promise<CorrectedTags> {
    const { sourceRoot } = context;
    const request = buildCorrectionRequest(source, sourceRoot, stored.info);
    return correctTags(stored, request, context);
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
    const storedTags = await getTagStore(source).read(source);
    context.logger.info(formatTagsLine(storedTags.info));
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
