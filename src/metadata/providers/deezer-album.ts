import {
    isSameArtist,
    isSameArtistName,
    isSearchedAlbum,
    isVariousCredit,
} from "../track-matching.js";
import { buildTracklist } from "../album-tracklist.js";
import {
    extractYear,
    optionalText,
    removeUnknownValues,
    valueOrEmpty,
} from "../track-metadata.js";
import type {
    AlbumSearch,
    AlbumSource,
    AlbumTrackEntry,
    FoundAlbum,
    ProviderServices,
} from "../types.js";
import {
    buildQuery,
    getCoverRequests,
    getDeezerGenre,
    type DeezerAlbum,
    type DeezerAlbumSummary,
    type DeezerAlbumTrack,
    type DeezerArtist,
    type DeezerClient,
} from "./deezer-client.js";

type AlbumDetails = Pick<FoundAlbum, "year" | "genre" | "tracks">;

interface FoundArtist extends DeezerArtist {
    id: number;
}

function isSearched(album: DeezerAlbumSummary, search: AlbumSearch): boolean {
    const found = { album: album.title, artist: album.artist?.name };
    return isSearchedAlbum(found, search);
}

type ArtistCheck = (found: string | undefined, searched: string) => boolean;

function findArtistBy(
    artists: DeezerArtist[],
    name: string,
    isSame: ArtistCheck
): FoundArtist | undefined {
    return artists.find(
        (artist): artist is FoundArtist =>
            artist.id !== undefined && isSame(artist.name, name)
    );
}

// Deezer may rank a collaboration ("Scorpions & Friends") above the artist itself.
function findSearchedArtist(
    artists: DeezerArtist[],
    name: string
): FoundArtist | undefined {
    return (
        findArtistBy(artists, name, isSameArtistName) ??
        findArtistBy(artists, name, isSameArtist)
    );
}

function describeAlbum(album: DeezerAlbumSummary): FoundAlbum {
    return {
        album: valueOrEmpty(album.title),
        artist: valueOrEmpty(album.artist?.name),
        covers: getCoverRequests(album),
    };
}

function describeTrack({ title, artist }: DeezerAlbumTrack) {
    return { title: valueOrEmpty(title), artist: optionalText(artist?.name) };
}

function getTracklist(tracks: DeezerAlbumTrack[]): AlbumTrackEntry[] {
    const placed = tracks.filter(({ track_position }) => track_position);
    return buildTracklist(
        placed.map((track) => ({
            ...describeTrack(track),
            disc: track.disk_number ?? 1,
            track: track.track_position ?? 0,
        }))
    );
}

// Deezer dates what it does not know "0000-00-00".
function getReleaseYear({ release_date }: DeezerAlbum): string | undefined {
    const year = extractYear(release_date);
    return Number(year) > 0 ? year : undefined;
}

// Its release dates are often a reissue's, so other services' years come first.
function getDetails(
    album: DeezerAlbum,
    tracks: DeezerAlbumTrack[]
): AlbumDetails {
    return removeUnknownValues({
        year: getReleaseYear(album),
        genre: getDeezerGenre(album),
        tracks: getTracklist(tracks),
    });
}

export class DeezerAlbumSource implements AlbumSource {
    readonly name = "Deezer";

    constructor(
        private readonly client: DeezerClient,
        private readonly services: ProviderServices
    ) {}

    async findAlbum(search: AlbumSearch): Promise<FoundAlbum | null> {
        const album =
            (await this.searchAlbum(search)) ??
            (await this.findArtistAlbum(search));
        return album ? this.describeWithDetails(album) : null;
    }

    private async describeWithDetails(
        album: DeezerAlbumSummary
    ): Promise<FoundAlbum> {
        const details =
            album.id === undefined ? {} : await this.findDetails(album.id);
        return { ...describeAlbum(album), ...details };
    }

    // The search already named the album, which a failed detail must not undo.
    private async findDetails(albumId: number): Promise<AlbumDetails> {
        try {
            const album = await this.client.getAlbum(albumId);
            const tracks = await this.client.getAlbumTracks(albumId);
            return getDetails(album, tracks);
        } catch (error) {
            this.services.lookups.noteFailure("album details", error);
            return {};
        }
    }

    private async searchAlbum(
        search: AlbumSearch
    ): Promise<DeezerAlbumSummary | undefined> {
        const query = buildQuery([search.artist, search.album]);
        const albums = await this.client.searchAlbums(query);
        return albums.find((found) => isSearched(found, search));
    }

    // The album search misses albums that the artist's own list holds.
    private async findArtistAlbum(
        search: AlbumSearch
    ): Promise<DeezerAlbumSummary | undefined> {
        // Various artists have too many albums for their list to be searched.
        if (isVariousCredit(search.artist)) {
            return undefined;
        }

        const artists = await this.client.searchArtists(search.artist);
        const artist = findSearchedArtist(artists, search.artist);

        if (!artist) {
            return undefined;
        }

        const albums = await this.client.getArtistAlbums(artist.id);
        return albums
            .map((album) => ({ ...album, artist }))
            .find((album) => isSearched(album, search));
    }
}
