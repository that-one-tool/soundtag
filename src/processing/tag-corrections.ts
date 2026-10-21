import {
    applyCorrections,
    describeCorrection,
} from "../metadata/track-corrections.js";
import type { TrackCorrector } from "../metadata/track-corrector.js";
import { EMPTY_TRACK_INFO } from "../metadata/track-metadata.js";
import type {
    TagCorrection,
    TrackMetadata,
    TrackSearch,
} from "../metadata/types.js";
import type { Logger } from "../shared/logger.js";
import type { StoredTags } from "../tags/types.js";

export interface CorrectedTags {
    tags: StoredTags;
    corrections: TagCorrection[];
}

export interface CorrectionTools {
    corrector?: TrackCorrector;
    logger: Logger;
}

function logCorrections(corrections: TagCorrection[], logger: Logger): void {
    for (const correction of corrections) {
        logger.info(`Corrected ${describeCorrection(correction)}`);
    }
}

export async function correctTags(
    stored: StoredTags,
    search: TrackSearch,
    { corrector, logger }: CorrectionTools
): Promise<CorrectedTags> {
    if (!corrector) {
        return { tags: stored, corrections: [] };
    }

    logger.info("Checking the existing tags...");
    const corrections = await corrector.findCorrections(search, stored.info);
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
