import {
    extractYear,
    optionalCount,
    removeUnknownValues,
} from "../track-metadata.js";
import type { TrackExtras } from "../types.js";
import type {
    MusicBrainzMedium,
    MusicBrainzReleaseDetails,
    MusicBrainzTrack,
} from "./musicbrainz-client.js";

interface TrackPosition {
    medium: MusicBrainzMedium;
    track: MusicBrainzTrack;
}

function findTrackPosition(
    media: MusicBrainzMedium[],
    recordingId: string
): TrackPosition | undefined {
    const positions = media.flatMap((medium) =>
        (medium.tracks ?? []).map((track) => ({ medium, track }))
    );
    return positions.find(({ track }) => track.recording?.id === recordingId);
}

export function getTrackPositionExtras(
    { media = [] }: MusicBrainzReleaseDetails,
    recordingId: string
): TrackExtras {
    const position = findTrackPosition(media, recordingId);

    if (!position) {
        return {};
    }

    return removeUnknownValues({
        trackNumber: optionalCount(position.track.position),
        trackCount: optionalCount(position.medium["track-count"]),
        discNumber: optionalCount(position.medium.position),
        discCount: optionalCount(media.length),
    });
}

function getRecordingDate(
    media: MusicBrainzMedium[],
    recordingId: string
): string | undefined {
    return findTrackPosition(media, recordingId)?.track.recording?.[
        "first-release-date"
    ];
}

function getAlbumDate(release: MusicBrainzReleaseDetails): string | undefined {
    return release["release-group"]?.["first-release-date"];
}

function getEarliestYear(dates: (string | undefined)[]): string {
    const years = dates.map((date) => extractYear(date)).filter(Boolean);
    return years.toSorted()[0] ?? "";
}

// A compilation dates late through its album and a remaster through its
// recording, so the earliest of both is closest to the song's first release.
export function getFirstReleaseYear(
    release: MusicBrainzReleaseDetails,
    recordingId: string
): string {
    const recordingDate = getRecordingDate(release.media ?? [], recordingId);
    return getEarliestYear([recordingDate, getAlbumDate(release)]);
}
