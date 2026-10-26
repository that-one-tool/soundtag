import {
    isSameRelease,
    isSameTrack,
    isVariousArtists,
} from "../track-matching.js";
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
    TrackMetadata,
    TrackSearch,
} from "../types.js";
import type {
    DiscogsAlbum,
    DiscogsAlbumKind,
    DiscogsArtist,
    DiscogsClient,
    DiscogsTrack,
} from "./discogs-client.js";

interface DiscogsMatch {
    kind: DiscogsAlbumKind;
    album: DiscogsAlbum;
    track: DiscogsTrack;
    isRelease: boolean;
}

interface TrackPosition {
    disc: number;
    track: number;
}

// "3", "1-3", "CD1-3" or "2.03"; vinyl sides ("A1") give no track number.
const NUMBERED_POSITION = /^(?:(?:cd|disc)?\s*(\d+)\s*[-.]\s*)?(\d+)$/iu;
// Discogs tells namesakes apart with "(2)".
const ARTIST_NAME_MARKS = /\s*\(\d+\)$/gu;
const DISCOGS_VARIOUS_ARTISTS = "Various";
export const ALBUM_KINDS: readonly DiscogsAlbumKind[] = ["master", "release"];

function getArtistName({ name }: DiscogsArtist): string {
    return valueOrEmpty(name).replaceAll(ARTIST_NAME_MARKS, "");
}

function formatJoin({ join }: DiscogsArtist): string {
    const trimmed = valueOrEmpty(join).trim();
    return trimmed === "," ? ", " : ` ${trimmed} `;
}

function getCredit(artists: DiscogsArtist[] = []): string {
    return artists
        .map((artist) => `${getArtistName(artist)}${formatJoin(artist)}`)
        .join("")
        .replaceAll(/\s+/gu, " ")
        .trim();
}

export function getAlbumArtist({ artists }: DiscogsAlbum): string {
    const credit = getCredit(artists);
    return credit === DISCOGS_VARIOUS_ARTISTS ? "Various Artists" : credit;
}

export function getTrackArtist(
    track: DiscogsTrack,
    album: DiscogsAlbum
): string {
    return getCredit(track.artists) || getAlbumArtist(album);
}

// Headings and indexes split the tracklist without being songs.
const SONGS_BY_TYPE = new Map<string, (track: DiscogsTrack) => DiscogsTrack[]>([
    ["track", (track) => [track]],
    ["index", (track) => track.sub_tracks ?? []],
]);

function getTrackSongs(track: DiscogsTrack): DiscogsTrack[] {
    const { type_: type = "track" } = track;
    const getSongsOfType = SONGS_BY_TYPE.get(type);
    return getSongsOfType ? getSongsOfType(track) : [];
}

function getSongs({ tracklist = [] }: DiscogsAlbum): DiscogsTrack[] {
    return tracklist.flatMap(getTrackSongs);
}

function findSong(
    album: DiscogsAlbum,
    search: TrackSearch
): DiscogsTrack | undefined {
    return getSongs(album).find((track) =>
        isSameTrack(
            { title: track.title, artist: getTrackArtist(track, album) },
            search
        )
    );
}

function isSearchedRelease(
    album: DiscogsAlbum,
    track: DiscogsTrack,
    searchedAlbum: string
): boolean {
    const release = {
        album: album.title,
        albumArtist: getAlbumArtist(album),
        trackArtist: getTrackArtist(track, album),
    };
    return (
        isSameRelease(release, searchedAlbum) &&
        !isGuessedCompilation(album, searchedAlbum)
    );
}

// Without an album to look for, the top result is often a compilation.
function isGuessedCompilation(
    album: DiscogsAlbum,
    searchedAlbum: string
): boolean {
    return !searchedAlbum && isVariousArtists(getAlbumArtist(album));
}

function isAnythingNeeded({ cover, details }: ProviderNeeds): boolean {
    return cover || details;
}

function toPosition([, disc = "1", track]: RegExpExecArray): TrackPosition {
    return { disc: Number(disc), track: Number(track) };
}

export function parsePosition(
    position: string | undefined
): TrackPosition | null {
    const match = NUMBERED_POSITION.exec(valueOrEmpty(position).trim());
    return match ? toPosition(match) : null;
}

function getPositions(album: DiscogsAlbum): TrackPosition[] {
    return getSongs(album)
        .map(({ position }) => parsePosition(position))
        .filter((position) => position !== null);
}

// Like tags, the track count is per disc.
function getPositionExtras(
    album: DiscogsAlbum,
    track: DiscogsTrack
): TrackExtras {
    const position = parsePosition(track.position);

    if (!position) {
        return {};
    }

    const positions = getPositions(album);
    const discTracks = positions.filter(({ disc }) => disc === position.disc);
    return {
        trackNumber: optionalCount(position.track),
        trackCount: optionalCount(discTracks.length),
        discNumber: optionalCount(position.disc),
        discCount: optionalCount(
            Math.max(...positions.map(({ disc }) => disc))
        ),
    };
}

function getReleaseExtras({ album, track }: DiscogsMatch): TrackExtras {
    return {
        albumArtist: optionalText(getAlbumArtist(album)),
        ...getPositionExtras(album, track),
    };
}

function getExtras(match: DiscogsMatch): TrackExtras {
    const genre = optionalText(match.album.genres?.[0]);
    const release = match.isRelease ? getReleaseExtras(match) : {};
    return removeUnknownValues({ genre, ...release });
}

// Only a master's year is the album's first; a release can be a reissue.
function isOriginalAlbum({ kind, isRelease }: DiscogsMatch): boolean {
    return kind === "master" && isRelease;
}

function getYear(match: DiscogsMatch): string {
    const { year } = match.album;
    return isOriginalAlbum(match) && year ? String(year) : "";
}

function getImages({
    images,
}: DiscogsAlbum): NonNullable<DiscogsAlbum["images"]> {
    return images ?? [];
}

export function getCoverUrl(album: DiscogsAlbum): string | undefined {
    const images = getImages(album);
    const primary = images.find(({ type }) => type === "primary") ?? images[0];
    return primary?.uri;
}

function getWantedCoverUrl(
    { album, isRelease }: DiscogsMatch,
    isWanted: boolean
): string | undefined {
    return isWanted && isRelease ? getCoverUrl(album) : undefined;
}

function getMetadata(match: DiscogsMatch): Omit<TrackMetadata, "coverData"> {
    const { album, track, isRelease } = match;
    return {
        info: {
            title: valueOrEmpty(track.title),
            artist: getTrackArtist(track, album),
            album: isRelease ? valueOrEmpty(album.title) : "",
            year: getYear(match),
        },
        extras: getExtras(match),
    };
}

// Finds the song in the tracklist of the album Discogs ranks first.
export class DiscogsTrackFinder {
    constructor(
        private readonly client: DiscogsClient,
        private readonly services: ProviderServices
    ) {}

    async find(
        search: TrackSearch,
        needs: ProviderNeeds
    ): Promise<TrackMetadata | null> {
        const match = isAnythingNeeded(needs)
            ? await this.findMatch(search)
            : null;

        if (!match) {
            return null;
        }

        const coverData = await this.findCover(match, needs.cover);
        return { ...getMetadata(match), coverData };
    }

    private async findMatch(search: TrackSearch): Promise<DiscogsMatch | null> {
        for (const kind of ALBUM_KINDS) {
            const match = await this.findMatchOfKind(kind, search);
            if (match) {
                return match;
            }
        }

        return null;
    }

    private async findMatchOfKind(
        kind: DiscogsAlbumKind,
        search: TrackSearch
    ): Promise<DiscogsMatch | null> {
        const [result] = await this.client.searchAlbums(kind, search);

        if (result?.id === undefined) {
            return null;
        }

        const album = await this.client.getAlbum(kind, result.id);
        return matchSong({ kind, album }, search);
    }

    private findCover(
        match: DiscogsMatch,
        isWanted: boolean
    ): Promise<Buffer | null> {
        const url = getWantedCoverUrl(match, isWanted);
        return url
            ? this.services.images.downloadFirst([
                  this.client.getCoverRequest(url),
              ])
            : Promise.resolve(null);
    }
}

function matchSong(
    { kind, album }: Pick<DiscogsMatch, "kind" | "album">,
    search: TrackSearch
): DiscogsMatch | null {
    const track = findSong(album, search);
    return track
        ? {
              kind,
              album,
              track,
              isRelease: isSearchedRelease(album, track, search.album),
          }
        : null;
}

// First in the chain: it confirms the album of the folder or tags and its tracklist.
export class DiscogsAlbumProvider implements MetadataProvider {
    readonly name = "Discogs";

    constructor(private readonly finder: DiscogsTrackFinder) {}

    findMetadata(
        search: TrackSearch,
        needs: ProviderNeeds
    ): Promise<TrackMetadata | null> {
        return search.album
            ? this.finder.find(search, needs)
            : Promise.resolve(null);
    }
}

// Later in the chain, for songs whose album is still unknown.
export class DiscogsProvider implements MetadataProvider {
    readonly name = "Discogs";

    constructor(private readonly finder: DiscogsTrackFinder) {}

    findMetadata(
        search: TrackSearch,
        needs: ProviderNeeds
    ): Promise<TrackMetadata | null> {
        return search.album
            ? Promise.resolve(null)
            : this.finder.find(search, needs);
    }
}
