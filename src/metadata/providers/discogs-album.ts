import { isSearchedAlbum } from "../track-matching.js";
import { valueOrEmpty } from "../track-metadata.js";
import type { AlbumSearch, AlbumSource, FoundAlbum } from "../types.js";
import type {
    DiscogsAlbum,
    DiscogsAlbumKind,
    DiscogsClient,
} from "./discogs-client.js";
import { ALBUM_KINDS, getAlbumArtist, getCoverUrl } from "./discogs.js";

function isSearched(album: DiscogsAlbum, search: AlbumSearch): boolean {
    const found = { album: album.title, artist: getAlbumArtist(album) };
    return isSearchedAlbum(found, search);
}

// Discogs ranks the album first, so only its top result is checked.
export class DiscogsAlbumSource implements AlbumSource {
    readonly name = "Discogs";

    constructor(private readonly client: DiscogsClient) {}

    async findAlbum(search: AlbumSearch): Promise<FoundAlbum | null> {
        for (const kind of ALBUM_KINDS) {
            const album = await this.findAlbumOfKind(kind, search);
            if (album) {
                return this.describeAlbum(album);
            }
        }

        return null;
    }

    private async findAlbumOfKind(
        kind: DiscogsAlbumKind,
        search: AlbumSearch
    ): Promise<DiscogsAlbum | null> {
        const id = await this.searchAlbumId(kind, search);

        if (id === undefined) {
            return null;
        }

        const album = await this.client.getAlbum(kind, id);
        return isSearched(album, search) ? album : null;
    }

    private async searchAlbumId(
        kind: DiscogsAlbumKind,
        search: AlbumSearch
    ): Promise<number | undefined> {
        const searched = { title: "", ...search };
        const [result] = await this.client.searchAlbums(kind, searched);
        return result?.id;
    }

    private describeAlbum(album: DiscogsAlbum): FoundAlbum {
        const url = getCoverUrl(album);
        const covers = url ? [this.client.getCoverRequest(url)] : [];
        return { album: valueOrEmpty(album.title), covers };
    }
}
