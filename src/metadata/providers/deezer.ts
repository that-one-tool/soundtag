import { isSameRelease, isSameTrack } from "../track-matching.js";
import {
    optionalCount,
    optionalText,
    removeUnknownValues,
    valueOrEmpty,
} from "../track-metadata.js";
import type {
    MetadataProvider,
    ProviderNeeds,
    ProviderServices,
    TrackExtras,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../types.js";
import {
    buildQuery,
    getCoverRequests,
    type DeezerAlbum,
    type DeezerAlbumTrack,
    type DeezerClient,
    type DeezerTrack,
} from "./deezer-client.js";

interface DeezerDetails {
    extras: TrackExtras;
    isRelease: boolean;
}

interface DetailsRequest {
    albumId: number;
    track: DeezerTrack;
    isRelease: boolean;
}

const NO_DETAILS = { extras: {} };

function isSearchedTrack(track: DeezerTrack, search: TrackSearch): boolean {
    return isSameTrack(
        { title: track.title, artist: track.artist?.name },
        search
    );
}

function isSearchedRelease(track: DeezerTrack, search: TrackSearch): boolean {
    return isSameRelease({ album: track.album?.title }, search.album);
}

// Results can start with a karaoke version, or the song on another release.
function pickTrack(
    tracks: DeezerTrack[],
    search: TrackSearch
): DeezerTrack | null {
    const matches = tracks.filter((track) => isSearchedTrack(track, search));
    return (
        matches.find((track) => isSearchedRelease(track, search)) ??
        matches[0] ??
        null
    );
}

function getAlbumId(track: DeezerTrack): number | undefined {
    return track.album?.id;
}

function getAlbumTitle(track: DeezerTrack): string {
    return valueOrEmpty(track.album?.title);
}

// Deezer dates are often those of a reissue, so the year is left to others.
function getTrackInfo(track: DeezerTrack, isRelease: boolean): TrackInfo {
    return {
        title: valueOrEmpty(track.title),
        artist: valueOrEmpty(track.artist?.name),
        album: isRelease ? getAlbumTitle(track) : "",
        year: "",
    };
}

function getGenres({ genres }: DeezerAlbum): { name?: string }[] {
    return genres?.data ?? [];
}

function getGenre(album: DeezerAlbum): string | undefined {
    return optionalText(getGenres(album)[0]?.name);
}

function getAlbumArtist(album: DeezerAlbum): string | undefined {
    return optionalText(album.artist?.name);
}

function getDiscCount(tracks: DeezerAlbumTrack[]): number {
    return Math.max(0, ...tracks.map((track) => track.disk_number ?? 0));
}

function findPosition(
    tracks: DeezerAlbumTrack[],
    trackId: number | undefined
): DeezerAlbumTrack | undefined {
    return trackId === undefined
        ? undefined
        : tracks.find((track) => track.id === trackId);
}

// nb_tracks counts every disc, while the track count is per disc.
function getPositionExtras(
    tracks: DeezerAlbumTrack[],
    trackId: number | undefined
): TrackExtras {
    const position = findPosition(tracks, trackId);

    if (!position) {
        return {};
    }

    const discTracks = tracks.filter(
        (track) => track.disk_number === position.disk_number
    );
    return {
        trackNumber: optionalCount(position.track_position),
        trackCount: optionalCount(discTracks.length),
        discNumber: optionalCount(position.disk_number),
        discCount: optionalCount(getDiscCount(tracks)),
    };
}

// The search result has no album artist, so the album confirms the release.
function isReleaseOfTrack(
    album: DeezerAlbum,
    track: DeezerTrack,
    searchedAlbum: string
): boolean {
    const release = {
        album: album.title,
        albumArtist: album.artist?.name,
        trackArtist: track.artist?.name,
    };
    return isSameRelease(release, searchedAlbum);
}

function getGenreDetails(album: DeezerAlbum): DeezerDetails {
    const extras = removeUnknownValues({ genre: getGenre(album) });
    return { extras, isRelease: false };
}

export class DeezerProvider implements MetadataProvider {
    readonly name = "Deezer";

    constructor(
        private readonly client: DeezerClient,
        private readonly services: ProviderServices
    ) {}

    async findMetadata(
        search: TrackSearch,
        needs: ProviderNeeds
    ): Promise<TrackMetadata | null> {
        const track = await this.searchTrack(search);

        if (!track) {
            return null;
        }

        const details = await this.findDetails(track, search, needs.details);
        return {
            info: getTrackInfo(track, details.isRelease),
            extras: details.extras,
            coverData: await this.findCover(
                track,
                needs.cover && details.isRelease
            ),
        };
    }

    private async searchTrack(
        search: TrackSearch
    ): Promise<DeezerTrack | null> {
        const query = buildQuery([search.artist, search.title]);
        return pickTrack(await this.client.searchTracks(query), search);
    }

    private findDetails(
        track: DeezerTrack,
        search: TrackSearch,
        needsDetails: boolean
    ): Promise<DeezerDetails> {
        const isRelease = isSearchedRelease(track, search);
        const albumId = getAlbumId(track);

        if (!needsDetails || albumId === undefined) {
            return Promise.resolve({ ...NO_DETAILS, isRelease });
        }

        return this.loadDetails({ albumId, track, isRelease }, search.album);
    }

    private async loadDetails(
        request: DetailsRequest,
        searchedAlbum: string
    ): Promise<DeezerDetails> {
        try {
            return await this.loadAlbumDetails(request, searchedAlbum);
        } catch (error) {
            this.services.lookups.noteFailure("album lookup", error);
            return { ...NO_DETAILS, isRelease: request.isRelease };
        }
    }

    private async loadAlbumDetails(
        { albumId, track, isRelease }: DetailsRequest,
        searchedAlbum: string
    ): Promise<DeezerDetails> {
        const album = await this.client.getAlbum(albumId);
        const isConfirmed =
            isRelease && isReleaseOfTrack(album, track, searchedAlbum);
        return isConfirmed
            ? this.loadReleaseDetails(album, albumId, track.id)
            : getGenreDetails(album);
    }

    private async loadReleaseDetails(
        album: DeezerAlbum,
        albumId: number,
        trackId: number | undefined
    ): Promise<DeezerDetails> {
        const tracks = await this.client.getAlbumTracks(albumId);
        const extras = {
            genre: getGenre(album),
            albumArtist: getAlbumArtist(album),
            ...getPositionExtras(tracks, trackId),
        };
        return { extras: removeUnknownValues(extras), isRelease: true };
    }

    private findCover(
        track: DeezerTrack,
        isWanted: boolean
    ): Promise<Buffer | null> {
        return isWanted
            ? this.services.images.downloadFirst(getCoverRequests(track.album))
            : Promise.resolve(null);
    }
}
