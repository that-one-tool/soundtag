import type { ImageRequest } from "../../shared/http.js";
import { isSearchedAlbum } from "../track-matching.js";
import {
    extractYear,
    optionalText,
    removeUnknownValues,
    valueOrEmpty,
} from "../track-metadata.js";
import type { AlbumSearch, AlbumSource, FoundAlbum } from "../types.js";
import {
    getMusicBrainzArtist,
    type MusicBrainzClient,
    type MusicBrainzReleaseGroup,
} from "./musicbrainz-client.js";

const COVER_SIZES = [1200, 500];

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

    // Like Deezer's 1000 px artwork; the 500 px one when the archive has no larger.
    private getCoverRequests(groupId: string): ImageRequest[] {
        return COVER_SIZES.map((size) =>
            this.client.getReleaseGroupCoverRequest(groupId, size)
        );
    }

    private describeAlbum(group: MusicBrainzReleaseGroup): FoundAlbum {
        const { id, title } = group;
        return removeUnknownValues({
            album: valueOrEmpty(title),
            artist: getMusicBrainzArtist(group["artist-credit"]),
            year: optionalText(extractYear(group["first-release-date"])),
            covers: id ? this.getCoverRequests(id) : [],
        });
    }
}
