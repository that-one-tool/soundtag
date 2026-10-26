import { isSearchedAlbum } from "../track-matching.js";
import { valueOrEmpty } from "../track-metadata.js";
import type { AlbumSearch, AlbumSource, FoundAlbum } from "../types.js";
import {
    getMusicBrainzArtist,
    type MusicBrainzClient,
    type MusicBrainzReleaseGroup,
} from "./musicbrainz-client.js";

function isSearched(
    group: MusicBrainzReleaseGroup,
    search: AlbumSearch
): boolean {
    const artist = getMusicBrainzArtist(group["artist-credit"]);
    return isSearchedAlbum({ album: group.title, artist }, search);
}

export class MusicBrainzAlbumSource implements AlbumSource {
    readonly name = "MusicBrainz";

    constructor(private readonly client: MusicBrainzClient) {}

    async findAlbum(search: AlbumSearch): Promise<FoundAlbum | null> {
        const groups = await this.client.searchReleaseGroups(search);
        const group = groups.find((found) => isSearched(found, search));
        return group ? this.describeAlbum(group) : null;
    }

    private describeAlbum({ id, title }: MusicBrainzReleaseGroup): FoundAlbum {
        const covers = id ? [this.client.getReleaseGroupCoverRequest(id)] : [];
        return { album: valueOrEmpty(title), covers };
    }
}
