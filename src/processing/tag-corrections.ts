import type { LibraryPathTerms } from "../library/types.js";
import { applyCorrections } from "../metadata/track-corrections.js";
import type { TrackCorrector } from "../metadata/track-corrector.js";
import { EMPTY_TRACK_INFO } from "../metadata/track-metadata.js";
import { isSameAlbum } from "../metadata/track-matching.js";
import type {
    CorrectionRequest,
    FoundAlbum,
    TagCorrection,
    TrackExtras,
    TrackInfo,
    TrackMetadata,
} from "../metadata/types.js";
import type { Logger } from "../shared/logger.js";
import type { StoredTags, TagWrite } from "../tags/types.js";
import { chainCorrections, getPathCorrections } from "./path-corrections.js";
import { formatCorrectionsLine } from "./track-log.js";

type ExtraField = keyof TrackExtras;

export interface CorrectedTags {
    tags: StoredTags;
    corrections: TagCorrection[];
    // Release fields of a replaced album, cleared unless found again.
    forgottenExtras?: readonly ExtraField[];
    // The new album's cover, so the old album's never stays.
    folderCover?: Buffer;
}

// The request is built from the tags the path corrected, so services check those.
export interface CorrectionPlan {
    pathTerms: LibraryPathTerms | null;
    // Confirmed by a service, so it replaces the album outside fix mode too.
    folderAlbum: FoundAlbum | null;
    buildRequest(info: TrackInfo): CorrectionRequest;
    findFolderCover(): Promise<Buffer | null>;
}

export interface CorrectionTools {
    corrector?: TrackCorrector;
    logger: Logger;
}

const RELEASE_EXTRAS: ReadonlySet<string> = new Set<keyof TrackExtras>([
    "albumArtist",
    "trackNumber",
    "trackCount",
    "discNumber",
    "discCount",
]);

// Only the folder album corrects albums, and only another album; filling one keeps the release.
function isNewAlbum({ field, from }: TagCorrection): boolean {
    return field === "album" && Boolean(from.trim());
}

function getStoredExtras(stored: StoredTags): ExtraField[] {
    const fields = Object.keys(stored.extras) as ExtraField[];
    return fields.filter((field) => stored.extras[field] !== undefined);
}

// Treated as missing, so the search for the new album fills them again.
function forgetOldRelease(
    stored: StoredTags,
    corrections: TagCorrection[]
): CorrectedTags {
    if (!corrections.some(isNewAlbum)) {
        return { tags: stored, corrections };
    }

    const fields = getStoredExtras(stored);
    const kept = fields.filter((field) => !RELEASE_EXTRAS.has(field));
    const extras = Object.fromEntries(
        kept.map((field) => [field, stored.extras[field]])
    );
    return {
        tags: { ...stored, extras, hasCover: false },
        corrections,
        forgottenExtras: fields.filter((field) => RELEASE_EXTRAS.has(field)),
    };
}

async function findCorrections(
    info: TrackInfo,
    plan: CorrectionPlan,
    corrector: TrackCorrector
): Promise<TagCorrection[]> {
    const fromPath = getPathCorrections(info, plan.pathTerms);
    const pathInfo = applyCorrections(info, fromPath);
    const request = plan.buildRequest(pathInfo);
    const found = await corrector.findCorrections(request, pathInfo);
    return chainCorrections(fromPath, found);
}

function getFolderAlbumCorrections(
    info: TrackInfo,
    folderAlbum: FoundAlbum | null
): TagCorrection[] {
    // A tag naming the same album may only lack the service's notes ("(Remastered 2009)").
    return folderAlbum && !isSameAlbum(info.album, folderAlbum.album)
        ? [{ field: "album", from: info.album, to: folderAlbum.album }]
        : [];
}

async function findAllCorrections(
    info: TrackInfo,
    plan: CorrectionPlan,
    corrector: TrackCorrector | undefined
): Promise<TagCorrection[]> {
    const fromFolder = getFolderAlbumCorrections(info, plan.folderAlbum);
    const folderInfo = applyCorrections(info, fromFolder);
    const fromFix = corrector
        ? await findCorrections(folderInfo, plan, corrector)
        : [];
    return chainCorrections(fromFolder, fromFix);
}

export async function correctTags(
    stored: StoredTags,
    plan: CorrectionPlan,
    { corrector, logger }: CorrectionTools
): Promise<CorrectedTags> {
    const corrections = await findAllCorrections(stored.info, plan, corrector);
    if (corrections.length === 0) {
        return { tags: stored, corrections };
    }

    logger.info(formatCorrectionsLine(corrections));
    const info = applyCorrections(stored.info, corrections);
    const track = forgetOldRelease(stored, corrections);
    const corrected = { ...track, tags: { ...track.tags, info } };
    return addFolderCover(corrected, plan);
}

async function addFolderCover(
    track: CorrectedTags,
    plan: CorrectionPlan
): Promise<CorrectedTags> {
    if (!track.forgottenExtras) {
        return track;
    }

    const cover = await plan.findFolderCover();
    return cover
        ? {
              ...track,
              tags: { ...track.tags, hasCover: true },
              folderCover: cover,
          }
        : track;
}

function writeFolderCover(
    metadata: TrackMetadata,
    { folderCover }: CorrectedTags
): TrackMetadata {
    return folderCover && !metadata.coverData
        ? { ...metadata, coverData: folderCover }
        : metadata;
}

function clearForgottenExtras(
    metadata: TrackMetadata,
    { forgottenExtras = [] }: CorrectedTags
): TagWrite {
    const cleared = forgottenExtras.filter(
        (field) => metadata.extras[field] === undefined
    );
    return cleared.length > 0
        ? { ...metadata, clearedExtras: cleared }
        : metadata;
}

export function addReleaseChanges(
    metadata: TrackMetadata,
    track: CorrectedTags
): TagWrite {
    return clearForgottenExtras(writeFolderCover(metadata, track), track);
}

// Stores skip empty fields, so untouched multi-value tags and dates are kept.
export function getCorrectedMetadata({
    corrections,
}: CorrectedTags): TrackMetadata | null {
    if (corrections.length === 0) {
        return null;
    }

    const info = applyCorrections(EMPTY_TRACK_INFO, corrections);
    return { info, extras: {}, coverData: null };
}
