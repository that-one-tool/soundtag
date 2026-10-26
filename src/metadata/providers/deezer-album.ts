import { isSearchedAlbum } from "../track-matching.js";
import { valueOrEmpty } from "../track-metadata.js";
import type { AlbumSearch, AlbumSource, FoundAlbum } from "../types.js";
import {
    buildQuery,
    getCoverRequests,
    type DeezerAlbumSummary,
    type DeezerClient,
} from "./deezer-client.js";

function isSearched(album: DeezerAlbumSummary, search: AlbumSearch): boolean {
    const found = { album: album.title, artist: album.artist?.name };
    return isSearchedAlbum(found, search);
}

export class DeezerAlbumSource implements AlbumSource {
    readonly name = "Deezer";

    constructor(private readonly client: DeezerClient) {}

    async findAlbum(search: AlbumSearch): Promise<FoundAlbum | null> {
        const query = buildQuery([search.artist, search.album]);
        const albums = await this.client.searchAlbums(query);
        const album = albums.find((found) => isSearched(found, search));
        return album
            ? {
                  album: valueOrEmpty(album.title),
                  covers: getCoverRequests(album),
              }
            : null;
    }
}
