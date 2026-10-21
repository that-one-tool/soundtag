import { getErrorMessage } from "../../shared/errors.js";
import { isSameName } from "../track-matching.js";
import type { CoverProvider, ProviderServices, TrackSearch } from "../types.js";
import {
    buildQuery,
    getCoverRequests,
    type DeezerAlbumSummary,
    type DeezerClient,
} from "./deezer-client.js";

function getArtistName(album: DeezerAlbumSummary): string | undefined {
    return album.artist?.name;
}

function isSearchedAlbum(
    album: DeezerAlbumSummary,
    { artist, album: title }: TrackSearch
): boolean {
    const isSameArtist = !artist || isSameName(getArtistName(album), artist);
    return isSameArtist && isSameName(album.title, title);
}

export class DeezerCoverProvider implements CoverProvider {
    readonly name = "Deezer";

    constructor(
        private readonly client: DeezerClient,
        private readonly services: ProviderServices
    ) {}

    async findCover(search: TrackSearch): Promise<Buffer | null> {
        if (!search.album) {
            return null;
        }

        const album = await this.searchAlbum(search);
        return this.services.images.downloadFirst(getCoverRequests(album));
    }

    private async searchAlbum(
        search: TrackSearch
    ): Promise<DeezerAlbumSummary | undefined> {
        try {
            const query = buildQuery([search.artist, search.album]);
            const albums = await this.client.searchAlbums(query);
            return albums.find((album) => isSearchedAlbum(album, search));
        } catch (error) {
            this.services.logger.error(
                `Deezer album search failed: ${getErrorMessage(error)}`
            );
            return undefined;
        }
    }
}
