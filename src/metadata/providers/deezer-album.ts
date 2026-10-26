import {
    isSameArtist,
    isSameArtistName,
    isSearchedAlbum,
    isVariousCredit,
} from "../track-matching.js";
import { valueOrEmpty } from "../track-metadata.js";
import type { AlbumSearch, AlbumSource, FoundAlbum } from "../types.js";
import {
    buildQuery,
    getCoverRequests,
    type DeezerAlbumSummary,
    type DeezerArtist,
    type DeezerClient,
} from "./deezer-client.js";

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
        covers: getCoverRequests(album),
    };
}

export class DeezerAlbumSource implements AlbumSource {
    readonly name = "Deezer";

    constructor(private readonly client: DeezerClient) {}

    async findAlbum(search: AlbumSearch): Promise<FoundAlbum | null> {
        const album =
            (await this.searchAlbum(search)) ??
            (await this.findArtistAlbum(search));
        return album ? describeAlbum(album) : null;
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
