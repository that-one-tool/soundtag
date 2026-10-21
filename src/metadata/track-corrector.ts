import {
    getCorrections,
    getIdentityCorrections,
    mergeCanonicalTracks,
} from "./track-corrections.js";
import { isSameTrack } from "./track-matching.js";
import type {
    AlternativeSearch,
    CanonicalSource,
    CanonicalTrack,
    CorrectionRequest,
    TagCorrection,
    TrackInfo,
    TrackSearch,
} from "./types.js";

interface ConfirmedIdentity {
    track: CanonicalTrack;
    replaces: AlternativeSearch["replaces"];
}

function isConfirmedBy(
    witnessed: CanonicalTrack | null,
    { title, artist }: CanonicalTrack
): boolean {
    return (
        witnessed !== null &&
        isSameTrack(witnessed, { title, artist, album: "" })
    );
}

// A file name search can name another song than the title it would keep.
function keepsMatchingFields(
    { title, artist }: TrackInfo,
    { track, replaces }: ConfirmedIdentity
): boolean {
    const replaced = replaces.map((field) => [field, track[field]]);
    const kept = { title, artist, album: "", ...Object.fromEntries(replaced) };
    return isSameTrack(track, kept);
}

// The witness is another catalogue, since ListenBrainz matches are MusicBrainz data.
export class TrackCorrector {
    constructor(
        private readonly sources: CanonicalSource[],
        private readonly witness: CanonicalSource
    ) {}

    canCorrect(): boolean {
        return this.sources.length > 0;
    }

    async findCorrections(
        request: CorrectionRequest,
        info: TrackInfo
    ): Promise<TagCorrection[]> {
        const found = await this.findCanonicalTracks(request.tagSearch);
        const identity = await this.findIdentity(request, found, info);
        return identity
            ? getIdentityCorrections(info, identity.track, identity.replaces)
            : getCorrections(info, mergeCanonicalTracks(found));
    }

    private findIdentity(
        { alternatives, hasSuspectTags }: CorrectionRequest,
        found: CanonicalTrack[],
        info: TrackInfo
    ): Promise<ConfirmedIdentity | null> {
        const trustsTags = found.length > 0 && !hasSuspectTags;
        return trustsTags
            ? Promise.resolve(null)
            : this.findConfirmedIdentity(alternatives, info);
    }

    private async findConfirmedIdentity(
        alternatives: AlternativeSearch[],
        info: TrackInfo
    ): Promise<ConfirmedIdentity | null> {
        for (const alternative of alternatives) {
            const identity = await this.findAcceptedIdentity(alternative, info);
            if (identity) {
                return identity;
            }
        }

        return null;
    }

    private async findAcceptedIdentity(
        alternative: AlternativeSearch,
        info: TrackInfo
    ): Promise<ConfirmedIdentity | null> {
        const identity = await this.findConfirmedIdentityOf(alternative);
        return identity && keepsMatchingFields(info, identity)
            ? identity
            : null;
    }

    private async findConfirmedIdentityOf({
        search,
        replaces,
    }: AlternativeSearch): Promise<ConfirmedIdentity | null> {
        const found = await this.findCanonicalTracks(search);
        const track = mergeCanonicalTracks(found);

        if (!track.title) {
            return null;
        }

        const witnessed = await this.witness.findCanonical(search);
        return isConfirmedBy(witnessed, track) ? { track, replaces } : null;
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
