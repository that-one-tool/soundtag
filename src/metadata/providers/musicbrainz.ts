import { isSameRelease, isSameTrack } from "../track-matching.js";
import { extractYear, valueOrEmpty } from "../track-metadata.js";
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

function getCanonicalTrack(recording: MusicBrainzRecording): CanonicalTrack {
    return {
        title: recording.title ?? "",
        artist: getMusicBrainzArtist(recording["artist-credit"]),
        firstReleaseYear: extractYear(recording["first-release-date"]),
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

        const recording = await this.searchRecording(search);
        return recording && getCanonicalTrack(recording);
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
