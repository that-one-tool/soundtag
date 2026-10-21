import { getErrorMessage } from "../../shared/errors.js";
import { isSameRelease, isSameTrack } from "../track-matching.js";
import {
    extractYear,
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
    year: string;
    extras: TrackExtras;
}

const NO_DETAILS: DeezerDetails = { year: "", extras: {} };

function isSearchedTrack(track: DeezerTrack, search: TrackSearch): boolean {
    return isSameTrack(
        { title: track.title, artist: track.artist?.name },
        search
    );
}

// Numbers, counts and covers from another release (compilation, single) would be wrong.
function isSearchedRelease(track: DeezerTrack, search: TrackSearch): boolean {
    return isSameRelease(track.album?.title, search.album);
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

function getTrackInfo(track: DeezerTrack, year: string): TrackInfo {
    return {
        title: valueOrEmpty(track.title),
        artist: valueOrEmpty(track.artist?.name),
        album: valueOrEmpty(track.album?.title),
        year,
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

        const isRelease = isSearchedRelease(track, search);
        const details = await this.findDetails(track, isRelease, needs.details);
        return {
            info: getTrackInfo(track, details.year),
            extras: details.extras,
            coverData: await this.findCover(track, needs.cover && isRelease),
        };
    }

    private async searchTrack(
        search: TrackSearch
    ): Promise<DeezerTrack | null> {
        try {
            const query = buildQuery([search.artist, search.title]);
            return pickTrack(await this.client.searchTracks(query), search);
        } catch (error) {
            this.services.logger.error(
                `Deezer search failed: ${getErrorMessage(error)}`
            );
            return null;
        }
    }

    private findDetails(
        track: DeezerTrack,
        isRelease: boolean,
        needsDetails: boolean
    ): Promise<DeezerDetails> {
        const albumId = getAlbumId(track);

        if (!needsDetails || albumId === undefined) {
            return Promise.resolve(NO_DETAILS);
        }

        return this.loadDetails(albumId, track.id, isRelease);
    }

    private async loadDetails(
        albumId: number,
        trackId: number | undefined,
        isRelease: boolean
    ): Promise<DeezerDetails> {
        try {
            return isRelease
                ? await this.loadReleaseDetails(albumId, trackId)
                : await this.loadGenre(albumId);
        } catch (error) {
            this.services.logger.error(
                `Deezer album lookup failed: ${getErrorMessage(error)}`
            );
            return NO_DETAILS;
        }
    }

    private async loadGenre(albumId: number): Promise<DeezerDetails> {
        const album = await this.client.getAlbum(albumId);
        return {
            year: "",
            extras: removeUnknownValues({ genre: getGenre(album) }),
        };
    }

    private async loadReleaseDetails(
        albumId: number,
        trackId: number | undefined
    ): Promise<DeezerDetails> {
        const album = await this.client.getAlbum(albumId);
        const tracks = await this.client.getAlbumTracks(albumId);
        const extras = {
            genre: getGenre(album),
            albumArtist: getAlbumArtist(album),
            ...getPositionExtras(tracks, trackId),
        };
        return {
            year: extractYear(album.release_date),
            extras: removeUnknownValues(extras),
        };
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
