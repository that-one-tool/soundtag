import type { ImageRequest } from "../../shared/http.js";
import { buildTracklist, type TrackPlace } from "../album-tracklist.js";
import { isSearchedAlbum } from "../track-matching.js";
import {
    optionalText,
    removeUnknownValues,
    valueOrEmpty,
} from "../track-metadata.js";
import type {
    AlbumSearch,
    AlbumSource,
    AlbumTrackEntry,
    FoundAlbum,
} from "../types.js";
import type {
    DiscogsAlbum,
    DiscogsAlbumKind,
    DiscogsClient,
    DiscogsTrack,
} from "./discogs-client.js";
import {
    ALBUM_KINDS,
    getAlbumArtist,
    getCoverUrl,
    getTrackArtist,
    parsePosition,
} from "./discogs.js";

interface KindAlbum {
    kind: DiscogsAlbumKind;
    album: DiscogsAlbum;
}

function isSearched(album: DiscogsAlbum, search: AlbumSearch): boolean {
    const found = { album: album.title, artist: getAlbumArtist(album) };
    return isSearchedAlbum(found, search);
}

// An index is one song of the album, whatever its parts.
function isAlbumSong({ type_: type = "track" }: DiscogsTrack): boolean {
    return type === "track" || type === "index";
}

function placeSong(song: DiscogsTrack, album: DiscogsAlbum): TrackPlace | null {
    const position = parsePosition(song.position);
    const title = valueOrEmpty(song.title);
    const artist = getTrackArtist(song, album);
    return position && { title, artist, ...position };
}

// Vinyl sides ("A1") give no place; a partial tracklist would misnumber the rest.
function getTracklist(album: DiscogsAlbum): AlbumTrackEntry[] {
    const songs = (album.tracklist ?? []).filter(isAlbumSong);
    const places = songs.map((song) => placeSong(song, album));
    const placed = places.filter((place) => place !== null);
    return placed.length === places.length ? buildTracklist(placed) : [];
}

// Only a master's year is the album's first; a release can be a reissue.
function getYear({ kind, album }: KindAlbum): string | undefined {
    return kind === "master" && album.year ? String(album.year) : undefined;
}

// Discogs ranks the album first, so only its top result is checked.
export class DiscogsAlbumSource implements AlbumSource {
    readonly name = "Discogs";

    constructor(private readonly client: DiscogsClient) {}

    async findAlbum(search: AlbumSearch): Promise<FoundAlbum | null> {
        for (const kind of ALBUM_KINDS) {
            const album = await this.findAlbumOfKind(kind, search);
            if (album) {
                return this.describeAlbum({ kind, album });
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

    private describeAlbum(found: KindAlbum): FoundAlbum {
        const { album } = found;
        return removeUnknownValues({
            album: valueOrEmpty(album.title),
            artist: getAlbumArtist(album),
            year: getYear(found),
            genre: optionalText(album.genres?.[0]),
            covers: this.getCovers(album),
            tracks: getTracklist(album),
        });
    }

    private getCovers(album: DiscogsAlbum): ImageRequest[] {
        const url = getCoverUrl(album);
        return url ? [this.client.getCoverRequest(url)] : [];
    }
}
