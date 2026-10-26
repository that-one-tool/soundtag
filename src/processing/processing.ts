import * as path from "node:path";
import { getTagStore, isProperlyTagged } from "../tags/audio-tags.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import {
    inferLibraryFolderTerms,
    parseLibraryPath,
} from "../library/library-path.js";
import type { LibraryPathTerms } from "../library/types.js";
import type { MetadataChain } from "../metadata/metadata-chain.js";
import type { TrackCorrector } from "../metadata/track-corrector.js";
import {
    EMPTY_TRACK_INFO,
    fillMissingFields,
    getFirstFilled,
    getNewExtras,
    hasNewFields,
    mergeMetadata,
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
import type { StoredTags, TagWrite } from "../tags/types.js";
import { normalizeTagValue } from "./album-tags.js";
import { getOverwrite } from "./overwrite.js";
import { getAlternativeSearches } from "./correction-searches.js";
import {
    hasSuspectIdentity,
    hasSuspectTags,
    hasSuspectTitle,
} from "./suspect-tags.js";
import {
    isSameAlbum,
    isSameArtist,
    isSameName,
    hasNoteAfterName,
} from "../metadata/track-matching.js";
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
    overwriteTags?: boolean;
}

interface FoundMetadata {
    metadata: TrackMetadata;
    hasExistingCover: boolean;
}

interface TrackLookup {
    source: string;
    existing: ExistingTags;
    // The tags to search with, even when overwriting forgets them.
    hints: TrackInfo;
    replaceCover?: boolean;
}

interface SearchRun {
    metadataChain: MetadataChain;
    subject?: string;
    replaceCover?: boolean;
}

interface PlannedWrite {
    metadata: TagWrite | null;
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
    const filenameTerms =
        parseLibraryPath(source) ?? parseTrackFilename(path.basename(source));
    const folderTerms = inferLibraryFolderTerms(source, sourceRoot);

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
    { metadataChain, subject, replaceCover }: SearchRun
): Promise<TrackMetadata | null> {
    return metadataChain.lookups.step({ label: "search", subject }, () =>
        metadataChain.find(search, existing, { replaceCover })
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

function isTried(search: TrackSearch, tried: TrackSearch[]): boolean {
    return tried.some((triedSearch) => isSameSongSearch(search, triedSearch));
}

function shouldSearchFileName(
    fileSearch: TrackSearch,
    tried: TrackSearch[],
    hints: TrackInfo
): boolean {
    return hasSuspectTags(hints) && !isTried(fileSearch, tried);
}

// Wrong tags (an artist inside the title) also spoil the search they lead.
async function findFromFileName(
    { source, existing, hints, replaceCover }: TrackLookup,
    tried: TrackSearch[],
    { sourceRoot, metadataChain }: ProcessingContext
): Promise<TrackMetadata | null> {
    const search = buildTrackSearch(source, sourceRoot, EMPTY_TRACK_INFO);

    if (!shouldSearchFileName(search, tried, hints)) {
        return null;
    }

    const subject = `file name ${formatSearchSubject(search)}`;
    const withoutInfo = { ...existing, info: EMPTY_TRACK_INFO };
    const found = await searchServices(search, withoutInfo, {
        metadataChain,
        subject,
        replaceCover,
    });
    return found && keepExistingInfo(found, existing);
}

interface LookupSearches {
    pathSearch: LibraryPathTerms | null;
    tagSearch: TrackSearch;
}

function forgetIdentity(existing: ExistingTags): ExistingTags {
    return { ...existing, info: { ...existing.info, title: "", artist: "" } };
}

const SAME_SONG_CHECKS: ((
    first: TrackSearch,
    second: TrackSearch
) => boolean)[] = [
    (first, second) => isSameName(first.title, second.title),
    (first, second) => isSameArtist(first.artist, second.artist),
    (first, second) => isSameAlbum(first.album, second.album),
    (first, second) => isSameAlbum(second.album, first.album),
];

// Spelled differently ("AC DC", "AC/DC"), both would run the same rate-limited searches.
function isSameSongSearch(first: TrackSearch, second: TrackSearch): boolean {
    return SAME_SONG_CHECKS.every((isSame) => isSame(first, second));
}

function getNewPathSearch({
    pathSearch,
    tagSearch,
}: LookupSearches): TrackSearch | null {
    return pathSearch && !isSameSongSearch(pathSearch, tagSearch)
        ? pathSearch
        : null;
}

// Tags naming another version ("Song (Live)") must not get its details.
function namesTaggedSong({ info }: TrackMetadata, hints: TrackInfo): boolean {
    return (
        hasSuspectIdentity(hints) || !isOtherVersion(hints.title, info.title)
    );
}

function isOtherVersion(taggedTitle: string, foundTitle: string): boolean {
    return (
        hasNoteAfterName(taggedTitle, foundTitle) &&
        !isSameName(taggedTitle, foundTitle)
    );
}

function acceptPathResult(
    found: TrackMetadata | null,
    { existing, hints }: TrackLookup
): TrackMetadata | null {
    return found && namesTaggedSong(found, hints)
        ? keepExistingInfo(found, existing)
        : null;
}

// The path names the song better than tags do; its terms must lead the search.
async function findFromPath(
    lookup: TrackLookup,
    searches: LookupSearches,
    { metadataChain }: ProcessingContext
): Promise<TrackMetadata | null> {
    const search = getNewPathSearch(searches);
    if (!search) {
        return null;
    }

    const subject = `path ${formatSearchSubject(search)}`;
    const run = { metadataChain, subject, replaceCover: lookup.replaceCover };
    const withoutIdentity = forgetIdentity(lookup.existing);
    const found = await searchServices(search, withoutIdentity, run);
    return acceptPathResult(found, lookup);
}

function findFromTags(
    { existing, hints, replaceCover }: TrackLookup,
    tagSearch: TrackSearch,
    { metadataChain }: ProcessingContext
): Promise<TrackMetadata | null> {
    const subject = getSearchSubject(tagSearch, hints);
    const run = { metadataChain, subject, replaceCover };
    return searchServices(tagSearch, existing, run);
}

// Overwriting would otherwise replace a stored album with the folder's.
function getPinnedAlbum(
    { existing, hints }: TrackLookup,
    pathSearch: LibraryPathTerms | null
): string {
    const pathAlbum = hints.album.trim() ? "" : pathSearch?.album;
    return getFirstFilled(existing.info.album, pathAlbum);
}

// Best-ofs and compilations keep the album of their folder.
function pinFolderAlbum(
    lookup: TrackLookup,
    pathSearch: LibraryPathTerms | null
): TrackLookup {
    const { info } = lookup.existing;
    const album = getPinnedAlbum(lookup, pathSearch);
    return {
        ...lookup,
        existing: { ...lookup.existing, info: { ...info, album } },
    };
}

async function findTrackMetadata(
    lookup: TrackLookup,
    context: ProcessingContext
): Promise<TrackMetadata | null> {
    const { source, hints } = lookup;
    const pathSearch = parseLibraryPath(source);
    const pinned = pinFolderAlbum(lookup, pathSearch);
    const tagSearch = buildTrackSearch(source, context.sourceRoot, hints);
    const searches = { pathSearch, tagSearch };
    const found =
        (await findFromPath(pinned, searches, context)) ??
        (await findFromTags(pinned, tagSearch, context));
    const tried = [tagSearch, pathSearch].filter((search) => search !== null);
    return found ?? findFromFileName(pinned, tried, context);
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
    const lookup = { source, existing: track.tags, hints: track.tags.info };
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

interface ReadTrack {
    stored: StoredTags;
    track: CorrectedTags;
}

// Only the corrections are known up front, so they win over what is found.
function getOverwriteSeed(track: CorrectedTags): ExistingTags {
    const corrected = getCorrectedMetadata(track);
    const info = corrected ? corrected.info : EMPTY_TRACK_INFO;
    return { info, extras: {}, hasCover: track.tags.hasCover };
}

function readCoverToCompare(
    source: string,
    stored: StoredTags,
    found: TrackMetadata
): Promise<Buffer | null> {
    const needsCompare = stored.hasCover && found.coverData;
    return needsCompare
        ? getTagStore(source).readCover(source)
        : Promise.resolve(null);
}

// Tags no service finds are kept, so they are not missing.
function getStillMissingFields(
    found: TrackMetadata,
    stored: StoredTags
): string[] {
    return getMissingFields({
        metadata: mergeMetadata(found, { ...stored, coverData: null }),
        hasExistingCover: stored.hasCover,
    });
}

async function writeOverwrite(
    source: string,
    { stored, found }: { stored: StoredTags; found: TrackMetadata | null },
    logger: Logger
): Promise<TrackStatus> {
    const metadata = keepWritableMetadata(found, logger);
    if (!metadata) {
        return "SKIPPED";
    }

    const cover = await readCoverToCompare(source, stored, metadata);
    const missing = getStillMissingFields(metadata, stored);
    const overwrite = getOverwrite({ tags: stored, cover }, metadata);
    const planned = {
        metadata: overwrite,
        existing: EMPTY_TRACK_INFO,
        missing,
    };
    return writeNewMetadata(source, planned, logger);
}

async function overwriteTrack(
    source: string,
    { stored, track }: ReadTrack,
    context: ProcessingContext
): Promise<TrackStatus> {
    const existing = getOverwriteSeed(track);
    const hints = track.tags.info;
    const lookup = { source, existing, hints, replaceCover: true };
    const found = await findTrackMetadata(lookup, context);
    if (!isWritable(found) && getCorrectedMetadata(track)) {
        return writeCorrections(source, track, context.logger);
    }

    return writeOverwrite(source, { stored, found }, context.logger);
}

function tagReadTrack(
    source: string,
    read: ReadTrack,
    context: ProcessingContext
): Promise<TrackStatus> {
    return context.overwriteTags
        ? overwriteTrack(source, read, context)
        : tagCorrectedTrack(source, read.track, context);
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
    const plan = {
        pathTerms: parseLibraryPath(source),
        buildRequest: (info: TrackInfo) =>
            buildCorrectionRequest(source, context.sourceRoot, info),
    };
    return correctTags(stored, plan, context);
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
    const read = { stored: storedTags, track };
    const status = await tagReadTrack(source, read, context);
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
