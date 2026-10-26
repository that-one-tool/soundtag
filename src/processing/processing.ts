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
import {
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
import type { StoredTags, TagWrite } from "../tags/types.js";
import {
    isSameAlbum,
    isSameArtist,
    isSameName,
    hasNoteAfterName,
} from "../metadata/track-matching.js";
import {
    formatSearchSubject,
    formatSkipLine,
    formatTagsLine,
    formatWriteLine,
} from "./track-log.js";
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

interface TrackLookup {
    source: string;
    existing: ExistingTags;
    // The stored tags, before the path album is pinned.
    hints: TrackInfo;
}

interface SearchRun {
    metadataChain: MetadataChain;
    subject?: string;
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
    { metadataChain, subject }: SearchRun
): Promise<TrackMetadata | null> {
    return metadataChain.lookups.step({ label: "search", subject }, () =>
        metadataChain.find(search, existing)
    );
}

function hasTitleAndArtist({ info }: TrackMetadata): boolean {
    return [info.title, info.artist].every((field) => field.trim());
}

function normalizeTagValue(value: string): string {
    return value.normalize("NFC").trim().toLowerCase();
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

function keepExistingInfo(
    metadata: TrackMetadata,
    { info }: ExistingTags
): TrackMetadata {
    return { ...metadata, info: fillMissingFields(info, metadata.info) };
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
    return found && !isOtherVersion(hints.title, found.info.title)
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
    const withoutIdentity = forgetIdentity(lookup.existing);
    const run = { metadataChain, subject };
    const found = await searchServices(search, withoutIdentity, run);
    return acceptPathResult(found, lookup);
}

function findFromTags(
    { existing, hints }: TrackLookup,
    tagSearch: TrackSearch,
    { metadataChain }: ProcessingContext
): Promise<TrackMetadata | null> {
    const subject = getSearchSubject(tagSearch, hints);
    return searchServices(tagSearch, existing, { metadataChain, subject });
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
    return (
        (await findFromPath(pinned, searches, context)) ??
        findFromTags(pinned, tagSearch, context)
    );
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

function planWrite(tags: StoredTags, metadata: TrackMetadata): PlannedWrite {
    const hasExistingCover = tags.hasCover;
    return {
        metadata: getNewMetadata(tags, metadata),
        existing: tags.info,
        missing: getMissingFields({ metadata, hasExistingCover }),
    };
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

async function tagUntaggedTrack(
    source: string,
    tags: StoredTags,
    context: ProcessingContext
): Promise<TrackStatus> {
    const lookup = { source, existing: tags, hints: tags.info };
    const found = await findTrackMetadata(lookup, context);
    const writable = keepWritableMetadata(found, context.logger);

    if (!writable) {
        return "SKIPPED";
    }

    return writeNewMetadata(source, planWrite(tags, writable), context.logger);
}

async function tagTrack(
    source: string,
    context: ProcessingContext
): Promise<TrackStatus> {
    const stored = await getTagStore(source).read(source);
    context.logger.info(formatTagsLine(stored.info));

    if (isProperlyTagged(stored)) {
        context.logger.info(formatSkipLine("already tagged"));
        return "SKIPPED";
    }

    return tagUntaggedTrack(source, stored, context);
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
