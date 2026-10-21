import { getCorrections, mergeCanonicalTracks } from "./track-corrections.js";
import type {
    CanonicalSource,
    CanonicalTrack,
    TagCorrection,
    TrackInfo,
    TrackSearch,
} from "./types.js";

export class TrackCorrector {
    constructor(private readonly sources: CanonicalSource[]) {}

    canCorrect(): boolean {
        return this.sources.length > 0;
    }

    async findCorrections(
        search: TrackSearch,
        info: TrackInfo
    ): Promise<TagCorrection[]> {
        const found = await this.findCanonicalTracks(search);
        return getCorrections(info, mergeCanonicalTracks(found));
    }

    private async findCanonicalTracks(
        search: TrackSearch
    ): Promise<CanonicalTrack[]> {
        const found: CanonicalTrack[] = [];

        for (const source of this.sources) {
            const track = await source.findCanonical(search);
            if (track) {
                found.push(track);
            }
        }

        return found;
    }
}
