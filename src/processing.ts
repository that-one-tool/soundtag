import * as path from "node:path";
import { getTagStore, isProperlyTagged } from "./audio-tags.js";
import { getErrorMessage } from "./errors.js";
import { inferFolderSearchTerms } from "./folder-context.js";
import type { MetadataChain } from "./metadata-chain.js";
import { getFirstFilled } from "./track-metadata.js";
import { parseTrackFilename } from "./track-name-parser.js";
import type {
    TrackInfo,
    TrackMetadata,
    TrackSearch,
    TrackStatus,
} from "./types.js";

export interface ProcessingContext {
    sourceRoot: string;
    metadataChain: MetadataChain;
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

function logSearch({ title, artist, album }: TrackSearch): void {
    console.log(
        `Searching: "${title}"${formatSearchDetail("artist", artist)}${formatSearchDetail("album", album)}`
    );
}

function hasTitleAndArtist({ info }: TrackMetadata): boolean {
    return [info.title, info.artist].every((field) => field.trim());
}

async function findWritableMetadata(
    metadataChain: MetadataChain,
    search: TrackSearch,
    existingInfo: TrackInfo
): Promise<TrackMetadata | null> {
    const metadata = await metadataChain.find(search, existingInfo);

    if (!metadata) {
        console.log(
            "Track not found on available metadata services. Leaving source unchanged."
        );
        return null;
    }

    if (!hasTitleAndArtist(metadata)) {
        console.log(
            "Track title or artist is missing. Leaving source unchanged."
        );
        return null;
    }

    return metadata;
}

function logMissingFields(metadata: TrackMetadata): void {
    const missingFields = OPTIONAL_FIELD_CHECKS.filter(([, isMissing]) =>
        isMissing(metadata)
    ).map(([label]) => label);

    if (missingFields.length > 0) {
        console.log(
            `Some metadata was unavailable (${missingFields.join(", ")}); saving the fields that were found.`
        );
    }
}

async function tagUntaggedTrack(
    source: string,
    existingInfo: TrackInfo,
    { sourceRoot, metadataChain }: ProcessingContext
): Promise<TrackStatus> {
    const search = buildTrackSearch(source, sourceRoot, existingInfo);
    logSearch(search);
    const metadata = await findWritableMetadata(
        metadataChain,
        search,
        existingInfo
    );

    if (!metadata) {
        return "SKIPPED";
    }

    logMissingFields(metadata);
    await getTagStore(source).write(source, metadata);
    console.log("Successfully tagged source file.");
    return "TAGGED";
}

async function tagTrack(
    source: string,
    context: ProcessingContext
): Promise<TrackStatus> {
    const storedTags = await getTagStore(source).read(source);

    if (isProperlyTagged(storedTags)) {
        console.log("Already properly tagged. Skipping.");
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
        console.error(`Processing error: ${getErrorMessage(error)}`);
        return "FAILED";
    }
}
