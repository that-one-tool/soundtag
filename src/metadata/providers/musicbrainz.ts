import {
    isSameCredit,
    isSameRelease,
    isSameTrack,
    isVariousArtists,
} from "../track-matching.js";
import {
    extractYear,
    getEarliestYear,
    valueOrEmpty,
} from "../track-metadata.js";
import type {
    CanonicalSource,
    CanonicalTrack,
    MetadataProvider,
    ProviderNeeds,
    ProviderServices,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../types.js";
import type {
    MusicBrainzArtistCredit,
    MusicBrainzClient,
    MusicBrainzRecording,
    MusicBrainzRelease,
} from "./musicbrainz-client.js";

function getCreditName({ name, artist }: MusicBrainzArtistCredit): string {
    return name ?? valueOrEmpty(artist?.name);
}

function getMusicBrainzArtist(credits: MusicBrainzArtistCredit[] = []): string {
    return credits
        .map((credit) => `${getCreditName(credit)}${credit.joinphrase ?? ""}`)
        .join("")
        .trim();
}

function getCreditedReleases(
    recording: MusicBrainzRecording
): MusicBrainzRelease[] {
    const trackArtist = getMusicBrainzArtist(recording["artist-credit"]);
    return (recording.releases ?? []).filter((release) =>
        isSameRelease(
            {
                albumArtist: getMusicBrainzArtist(release["artist-credit"]),
                trackArtist,
            },
            ""
        )
    );
}

// A recording only released by another artist is a mis-credited cover.
function isReleasedByArtist(recording: MusicBrainzRecording): boolean {
    const hasReleases = (recording.releases ?? []).length > 0;
    return !hasReleases || getCreditedReleases(recording).length > 0;
}

function getSearchedReleases(
    recording: MusicBrainzRecording,
    searchedAlbum: string
): MusicBrainzRelease[] {
    return getCreditedReleases(recording).filter((release) =>
        isSameRelease({ album: release.title }, searchedAlbum)
    );
}

function getFirstRelease(releases: MusicBrainzRelease[]): MusicBrainzRelease {
    return releases[0] ?? {};
}

function getRecordingYear(
    recording: MusicBrainzRecording,
    release: MusicBrainzRelease
): string {
    return (
        extractYear(recording["first-release-date"]) ||
        extractYear(release.date)
    );
}

function getRecordingInfo(
    recording: MusicBrainzRecording,
    release: MusicBrainzRelease
): TrackInfo {
    return {
        title: recording.title ?? "",
        artist: getMusicBrainzArtist(recording["artist-credit"]),
        album: release.title ?? "",
        year: getRecordingYear(recording, release),
    };
}

function getCredit(recording: MusicBrainzRecording): string {
    return getMusicBrainzArtist(recording["artist-credit"]);
}

// The original of a remix credits fewer artists, so its year is not the remix's.
function keepSameCredit(
    recordings: MusicBrainzRecording[],
    artist: string
): MusicBrainzRecording[] {
    return recordings.filter((recording) =>
        isSameCredit(getCredit(recording), artist)
    );
}

function getFirstReleaseYear(recordings: MusicBrainzRecording[]): string {
    return getEarliestYear(
        recordings.map((recording) =>
            extractYear(recording["first-release-date"])
        )
    );
}

function getReleaseTitles(releases: MusicBrainzRelease[]): string[] {
    const titles = releases.map(({ title }) => valueOrEmpty(title));
    return [...new Set(titles.filter(Boolean))];
}

// Credited releases are the artist's own or compilations.
function isArtistRelease(release: MusicBrainzRelease): boolean {
    const albumArtist = getMusicBrainzArtist(release["artist-credit"]);
    return Boolean(albumArtist) && !isVariousArtists(albumArtist);
}

function getAlbums(
    recordings: MusicBrainzRecording[]
): Pick<CanonicalTrack, "albums" | "artistAlbums"> {
    const releases = recordings.flatMap(getCreditedReleases);
    return {
        albums: getReleaseTitles(releases),
        artistAlbums: getReleaseTitles(releases.filter(isArtistRelease)),
    };
}

// A shared artist also matches the original of a remix, which ranks first at times.
function pickNamedRecording(
    recordings: MusicBrainzRecording[],
    { artist }: TrackSearch
): MusicBrainzRecording {
    const sameCredit = recordings.find((recording) =>
        isSameCredit(getCredit(recording), artist)
    );
    return sameCredit ?? recordings[0];
}

// A remaster or compilation is another recording with a later first release.
function getCanonicalTrack(
    recordings: MusicBrainzRecording[],
    search: TrackSearch
): CanonicalTrack {
    const named = pickNamedRecording(recordings, search);
    const artist = getCredit(named);
    const sameCredit = keepSameCredit(recordings, artist);
    return {
        title: named.title ?? "",
        artist,
        firstReleaseYear: getFirstReleaseYear(sameCredit),
        ...getAlbums(recordings),
    };
}

function isSearchedRecording(
    recording: MusicBrainzRecording,
    search: TrackSearch
): boolean {
    const found = {
        title: recording.title,
        artist: getMusicBrainzArtist(recording["artist-credit"]),
    };
    return isSameTrack(found, search) && isReleasedByArtist(recording);
}

function keepSearchedRecording(
    recording: MusicBrainzRecording | undefined,
    search: TrackSearch
): MusicBrainzRecording | null {
    if (!recording) {
        return null;
    }

    return isSearchedRecording(recording, search) ? recording : null;
}

export class MusicBrainzProvider implements MetadataProvider, CanonicalSource {
    readonly name = "MusicBrainz";

    constructor(
        private readonly client: MusicBrainzClient,
        private readonly services: ProviderServices
    ) {}

    async findMetadata(
        search: TrackSearch,
        { cover: needsCover }: ProviderNeeds
    ): Promise<TrackMetadata | null> {
        const recording = await this.searchRecording(search);

        if (!recording) {
            return null;
        }

        const releases = getSearchedReleases(recording, search.album);
        return {
            info: getRecordingInfo(recording, getFirstRelease(releases)),
            extras: {},
            coverData: needsCover ? await this.downloadCover(releases) : null,
        };
    }

    // Any song of that title would match without an artist.
    async findCanonical(search: TrackSearch): Promise<CanonicalTrack | null> {
        if (!search.artist) {
            return null;
        }

        const recordings = await this.client.searchAllRecordings(search);
        const matching = recordings.filter((recording) =>
            isSearchedRecording(recording, search)
        );
        return matching.length > 0 ? getCanonicalTrack(matching, search) : null;
    }

    private async searchRecording(
        search: TrackSearch
    ): Promise<MusicBrainzRecording | null> {
        const [recording] = await this.client.searchRecordings(search);
        return keepSearchedRecording(recording, search);
    }

    private downloadCover(
        releases: MusicBrainzRelease[]
    ): Promise<Buffer | null> {
        return this.services.images.downloadFirst(
            releases.flatMap(({ id }) =>
                id ? [this.client.getCoverRequest(id)] : []
            )
        );
    }
}
