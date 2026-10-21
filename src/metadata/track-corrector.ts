import {
    findAlbumReplacement,
    getCorrections,
    getFolderCandidate,
    getIdentityCorrections,
    isDisputedAlbum,
    mergeCanonicalTracks,
} from "./track-corrections.js";
import type { LookupLog } from "../shared/lookup-log.js";
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

// The song a correction relies on and the search that found it.
interface FoundSong {
    track: CanonicalTrack;
    search: TrackSearch;
}

interface ConfirmedIdentity extends FoundSong {
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

function describeAlternative({ kind, search }: AlternativeSearch): string {
    return `${kind} "${search.title}" · ${search.artist}`;
}

// The witness is another catalogue, since ListenBrainz matches are MusicBrainz data.
export class TrackCorrector {
    constructor(
        private readonly sources: CanonicalSource[],
        private readonly witness: CanonicalSource,
        private readonly lookups: LookupLog
    ) {}

    canCorrect(): boolean {
        return this.sources.length > 0;
    }

    async findCorrections(
        request: CorrectionRequest,
        info: TrackInfo
    ): Promise<TagCorrection[]> {
        const found = await this.lookups.step({ label: "check" }, () =>
            this.findCanonicalTracks(request.tagSearch)
        );
        const identity = await this.findIdentity(request, found, info);
        const song = identity ?? {
            track: mergeCanonicalTracks(found),
            search: request.tagSearch,
        };
        const corrections = identity
            ? getIdentityCorrections(info, identity.track, identity.replaces)
            : getCorrections(info, song.track);
        const album = await this.findAlbumCorrections(info, song, request);
        return [...corrections, ...album];
    }

    private async findAlbumCorrections(
        info: TrackInfo,
        song: FoundSong,
        { folderAlbum }: CorrectionRequest
    ): Promise<TagCorrection[]> {
        if (!isDisputedAlbum(info, song.track.albums, folderAlbum)) {
            return [];
        }

        const to = await this.findReplacementAlbum(info, song, folderAlbum);
        return to ? [{ field: "album", from: info.album, to }] : [];
    }

    // Only an album the artist released replaces it, never a compilation.
    private async findReplacementAlbum(
        info: TrackInfo,
        song: FoundSong,
        folderAlbum: string
    ): Promise<string> {
        const candidate = getFolderCandidate(folderAlbum, info.artist);
        const releases = song.track.artistAlbums;
        return (
            findAlbumReplacement(releases, [candidate]) ||
            this.findWitnessedAlbum(info, song)
        );
    }

    // Deezer names one album for the song, which counts only if MusicBrainz lists it.
    private async findWitnessedAlbum(
        info: TrackInfo,
        { track, search }: FoundSong
    ): Promise<string> {
        const step = { label: "check", subject: `album "${info.album}"` };
        const witnessed = await this.lookups.step(step, () =>
            this.findCanonicalTrack(this.witness, search)
        );
        return findAlbumReplacement(
            track.artistAlbums,
            witnessed?.albums ?? []
        );
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
        const step = {
            label: "check",
            subject: describeAlternative(alternative),
        };
        const identity = await this.lookups.step(step, () =>
            this.findConfirmedIdentityOf(alternative)
        );
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

        const witnessed = await this.findCanonicalTrack(this.witness, search);
        return isConfirmedBy(witnessed, track)
            ? { track, search, replaces }
            : null;
    }

    private async findCanonicalTracks(
        search: TrackSearch
    ): Promise<CanonicalTrack[]> {
        const found: CanonicalTrack[] = [];

        for (const source of this.sources) {
            const track = await this.findCanonicalTrack(source, search);
            if (track) {
                found.push(track);
            }
        }

        return found;
    }

    private findCanonicalTrack(
        source: CanonicalSource,
        search: TrackSearch
    ): Promise<CanonicalTrack | null> {
        return this.lookups.call(source.name, () =>
            source.findCanonical(search)
        );
    }
}
