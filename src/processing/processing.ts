import * as path from "node:path";
import { getTagStore } from "../tags/audio-tags.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import {
    inferLibraryFolderTerms,
    parseLibraryPath,
} from "../library/library-path.js";
import type { LibraryPathTerms } from "../library/types.js";
import type { MetadataChain } from "../metadata/metadata-chain.js";
import {
    fillMissingExtras,
    fillMissingFields,
    getFirstFilled,
} from "../metadata/track-metadata.js";
import { parseTrackFilename } from "../library/track-name-parser.js";
import type {
    ExistingTags,
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
import { getWritePolicy, type WritePolicy } from "./write-policy.js";

export interface ProcessingContext {
    sourceRoot: string;
    metadataChain: MetadataChain;
    logger: Logger;
    // Found values replace the stored ones instead of only filling the gaps.
    overwrite?: boolean;
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
    replaceCover: boolean;
}

interface SearchRun {
    metadataChain: MetadataChain;
    subject?: string;
    replaceCover: boolean;
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
    const { replaceCover } = lookup;
    const run = { metadataChain, subject, replaceCover };
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

interface ReadTrack {
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

async function tagUntaggedTrack(
    track: ReadTrack,
    context: ProcessingContext
): Promise<TrackStatus> {
    const { source, stored, policy } = track;
    const existing = policy.getSearchedTags(stored);
    const { replacesCover: replaceCover } = policy;
    const lookup = { source, existing, hints: stored.info, replaceCover };
    const found = await findTrackMetadata(lookup, context);
    const writable = keepWritableMetadata(found, context.logger);

    if (!writable) {
        return "SKIPPED";
    }

    const metadata = await dropStoredCover(track, writable);
    return writeNewMetadata(source, planWrite(track, metadata), context.logger);
}

async function tagTrack(
    source: string,
    context: ProcessingContext
): Promise<TrackStatus> {
    const stored = await getTagStore(source).read(source);
    const policy = getWritePolicy(context.overwrite === true);
    context.logger.info(formatTagsLine(stored.info));

    if (policy.skipsTaggedTrack(stored)) {
        context.logger.info(formatSkipLine("already tagged"));
        return "SKIPPED";
    }

    return tagUntaggedTrack({ source, stored, policy }, context);
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
