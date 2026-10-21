import { applyCorrections } from "../metadata/track-corrections.js";
import type { TrackCorrector } from "../metadata/track-corrector.js";
import { EMPTY_TRACK_INFO } from "../metadata/track-metadata.js";
import type {
    CorrectionRequest,
    TagCorrection,
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
    return { tags: { ...stored, info }, corrections };
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
