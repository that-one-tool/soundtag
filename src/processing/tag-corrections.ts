import { applyCorrections } from "../metadata/track-corrections.js";
import type { TrackCorrector } from "../metadata/track-corrector.js";
import { EMPTY_TRACK_INFO } from "../metadata/track-metadata.js";
import type {
    CorrectionRequest,
    TagCorrection,
    TrackExtras,
    TrackMetadata,
} from "../metadata/types.js";
import type { Logger } from "../shared/logger.js";
import type { StoredTags } from "../tags/types.js";
import { formatCorrectionsLine } from "./track-log.js";

export interface CorrectedTags {
    tags: StoredTags;
    corrections: TagCorrection[];
}

export interface CorrectionTools {
    corrector?: TrackCorrector;
    logger: Logger;
}

function logCorrections(corrections: TagCorrection[], logger: Logger): void {
    if (corrections.length > 0) {
        logger.info(formatCorrectionsLine(corrections));
    }
}

const RELEASE_EXTRAS: ReadonlySet<string> = new Set<keyof TrackExtras>([
    "albumArtist",
    "trackNumber",
    "trackCount",
    "discNumber",
    "discCount",
]);

// Treated as missing, so the search for the new album overwrites what it finds.
function forgetOldRelease(
    stored: StoredTags,
    corrections: TagCorrection[]
): StoredTags {
    if (!corrections.some(({ field }) => field === "album")) {
        return stored;
    }

    const kept = Object.entries(stored.extras).filter(
        ([field]) => !RELEASE_EXTRAS.has(field)
    );
    return { ...stored, extras: Object.fromEntries(kept), hasCover: false };
}

export async function correctTags(
    stored: StoredTags,
    request: CorrectionRequest,
    { corrector, logger }: CorrectionTools
): Promise<CorrectedTags> {
    if (!corrector) {
        return { tags: stored, corrections: [] };
    }

    const corrections = await corrector.findCorrections(request, stored.info);
    logCorrections(corrections, logger);
    const info = applyCorrections(stored.info, corrections);
    const tags = { ...forgetOldRelease(stored, corrections), info };
    return { tags, corrections };
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
