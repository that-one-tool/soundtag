import * as path from "node:path";
import { getTagStore, isProperlyTagged } from "../tags/audio-tags.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import {
    inferLibraryFolderTerms,
    parseAlbumFolder,
    parseLibraryPath,
} from "../library/library-path.js";
import type { AlbumFinder } from "../metadata/album-finder.js";
import type { LibraryPathTerms } from "../library/types.js";
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
    FoundAlbum,
    TrackExtras,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../metadata/types.js";
import type { StoredTags, TagWrite } from "../tags/types.js";
import { normalizeTagValue } from "./album-tags.js";
import { getAlternativeSearches } from "./correction-searches.js";
import { tagCoverOnly } from "./cover-only.js";
import { isStoredCover } from "./stored-cover.js";
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
    addReleaseChanges,
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
    albums?: AlbumFinder;
    replaceCovers?: boolean;
    coversOnly?: boolean;
}

interface FoundMetadata {
    metadata: TrackMetadata;
    hasExistingCover: boolean;
}

interface TrackLookup {
    source: string;
    existing: ExistingTags;
    // The stored tags, before the path album is pinned.
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

// Best-ofs and compilations keep the album of their folder.
function pinFolderAlbum(
    lookup: TrackLookup,
    pathSearch: LibraryPathTerms | null
): TrackLookup {
    const { info } = lookup.existing;
    const album = getFirstFilled(info.album, pathSearch?.album);
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
): TagWrite | null {
    const written =
        getNewMetadata(track.tags, metadata) ?? getCorrectedMetadata(track);
    return written && addReleaseChanges(written, track);
}

interface FoundTrack {
    track: CorrectedTags;
    found: TrackMetadata | null;
}

async function dropSameCover(
    source: string,
    tags: StoredTags,
    found: TrackMetadata
): Promise<TrackMetadata> {
    const isSame = await isStoredCover(source, tags, found.coverData);
    return isSame ? { ...found, coverData: null } : found;
}

async function tagFoundTrack(
    source: string,
    { track, found }: FoundTrack,
    { logger }: ProcessingContext
): Promise<TrackStatus> {
    const writable = keepWritableMetadata(found, logger);

    if (!writable) {
        return "SKIPPED";
    }

    const metadata = await dropSameCover(source, track.tags, writable);
    return writeNewMetadata(source, planWrite(track, metadata), logger);
}

function planWrite(
    track: CorrectedTags,
    metadata: TrackMetadata
): PlannedWrite {
    const hasExistingCover = track.tags.hasCover;
    return {
        metadata: getMetadataToWrite(track, metadata),
        existing: track.tags.info,
        missing: getMissingFields({ metadata, hasExistingCover }),
    };
}

function isWritable(found: TrackMetadata | null): boolean {
    return found !== null && hasTitleAndArtist(found);
}

interface TrackWrite {
    status: TrackStatus;
    songFound: boolean;
}

const IDENTITY_FIELDS: ReadonlySet<keyof TrackInfo> = new Set([
    "title",
    "artist",
]);

// Fix mode only changes the title or artist once services confirm the song.
function hasConfirmedIdentity({ corrections }: CorrectedTags): boolean {
    return corrections.some(({ field }) => IDENTITY_FIELDS.has(field));
}

// Corrections are still written when the services find nothing usable.
async function tagUntaggedTrack(
    source: string,
    track: CorrectedTags,
    context: ProcessingContext
): Promise<TrackWrite> {
    const lookup = {
        source,
        existing: track.tags,
        hints: track.tags.info,
        replaceCover: context.replaceCovers,
    };
    const found = await findTrackMetadata(lookup, context);
    const status = await writeFoundTrack(source, { track, found }, context);
    const songFound = isWritable(found) || hasConfirmedIdentity(track);
    return { status, songFound };
}

function writeFoundTrack(
    source: string,
    { track, found }: FoundTrack,
    context: ProcessingContext
): Promise<TrackStatus> {
    return isWritable(found) || !getCorrectedMetadata(track)
        ? tagFoundTrack(source, { track, found }, context)
        : writeCorrections(source, track, context.logger);
}

function writeCorrections(
    source: string,
    track: CorrectedTags,
    logger: Logger
): Promise<TrackStatus> {
    const corrected = getCorrectedMetadata(track);
    const metadata = corrected && addReleaseChanges(corrected, track);
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
): Promise<TrackWrite> {
    if (track.corrections.length > 0) {
        const status = await writeCorrections(source, track, logger);
        return { status, songFound: hasConfirmedIdentity(track) };
    }

    logger.info(formatSkipLine("already tagged"));
    return { status: "SKIPPED", songFound: false };
}

// A replaced album must still get its own release fields.
function needsNoSearch(
    track: CorrectedTags,
    context: ProcessingContext
): boolean {
    const keepsRelease = track.forgottenExtras === undefined;
    return (
        isProperlyTagged(track.tags) && keepsRelease && !context.replaceCovers
    );
}

function tagCorrectedTrack(
    source: string,
    track: CorrectedTags,
    context: ProcessingContext
): Promise<TrackWrite> {
    return needsNoSearch(track, context)
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
    };
}

function findFolderAlbum(
    source: string,
    albums: AlbumFinder | undefined
): Promise<FoundAlbum | null> {
    const terms = parseAlbumFolder(source);
    return terms && albums ? albums.findAlbum(terms) : Promise.resolve(null);
}

function findFolderCover(
    source: string,
    albums: AlbumFinder | undefined
): Promise<Buffer | null> {
    const terms = parseAlbumFolder(source);
    return terms && albums ? albums.findCover(terms) : Promise.resolve(null);
}

interface ReadTrack {
    stored: StoredTags;
    folderAlbum: FoundAlbum | null;
}

function readCorrectedTags(
    source: string,
    { stored, folderAlbum }: ReadTrack,
    context: ProcessingContext
): Promise<CorrectedTags> {
    const plan = {
        pathTerms: parseLibraryPath(source),
        folderAlbum,
        findFolderCover: () => findFolderCover(source, context.albums),
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

interface WrittenStatus {
    status: TrackStatus;
    stored: StoredTags;
}

// Only a write changes the tags, so other tracks keep the ones already read.
function getResultTags(
    source: string,
    { status, stored }: WrittenStatus,
    logger: Logger
): Promise<StoredTags | null> {
    return status === "TAGGED"
        ? readWrittenTags(source, logger)
        : Promise.resolve(stored);
}

async function tagReadTrack(
    source: string,
    stored: StoredTags,
    context: ProcessingContext
): Promise<TrackResult> {
    const folderAlbum = await findFolderAlbum(source, context.albums);
    const read = { stored, folderAlbum };
    const track = await readCorrectedTags(source, read, context);
    const { status, songFound } = await tagCorrectedTrack(
        source,
        track,
        context
    );
    const written = { status, stored: read.stored };
    const tags = await getResultTags(source, written, context.logger);
    return { status, tags, songFound, corrections: track.corrections };
}

async function coverReadTrack(
    source: string,
    stored: StoredTags,
    context: ProcessingContext
): Promise<TrackResult> {
    const search = buildTrackSearch(source, context.sourceRoot, stored.info);
    const findCover = () => findFolderCover(source, context.albums);
    const track = { stored, search, findFolderCover: findCover };
    const status = await tagCoverOnly(source, track, context);
    const tags = await getResultTags(
        source,
        { status, stored },
        context.logger
    );
    return { status, tags, songFound: false, corrections: [] };
}

async function tagTrack(
    source: string,
    context: ProcessingContext
): Promise<TrackResult> {
    const stored = await getTagStore(source).read(source);
    context.logger.info(formatTagsLine(stored.info));
    return context.coversOnly
        ? coverReadTrack(source, stored, context)
        : tagReadTrack(source, stored, context);
}

export async function processTrack(
    source: string,
    context: ProcessingContext
): Promise<TrackResult> {
    try {
        return await tagTrack(source, context);
    } catch (error) {
        context.logger.error(`Processing error: ${getErrorMessage(error)}`);
        return {
            status: "FAILED",
            tags: null,
            songFound: false,
            corrections: [],
        };
    }
}
