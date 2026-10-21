import { getErrorMessage } from "../../shared/errors.js";
import type { ImageRequest } from "../../shared/http.js";
import { isSameRelease, isSameTrack } from "../track-matching.js";
import {
    optionalText,
    removeUnknownValues,
    valueOrEmpty,
} from "../track-metadata.js";
import type {
    MetadataProvider,
    ProviderNeeds,
    ProviderServices,
    TrackExtras,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../types.js";
import type {
    ListenBrainzClient,
    ListenBrainzMatch,
    ListenBrainzRelease,
} from "./listenbrainz-client.js";
import { pickGenre } from "./listenbrainz-genre.js";
import type { MusicBrainzClient } from "./musicbrainz-client.js";
import {
    getFirstReleaseYear,
    getTrackPositionExtras,
} from "./musicbrainz-release.js";

interface ReleaseDetails {
    year: string;
    extras: TrackExtras;
}

interface ReleaseNeeds extends ProviderNeeds {
    isRelease: boolean;
}

interface CoverArt {
    caa_id: number;
    caa_release_mbid: string;
}

const NO_DETAILS: ReleaseDetails = { year: "", extras: {} };

function isSearchedMatch(
    match: ListenBrainzMatch,
    search: TrackSearch
): boolean {
    const found = {
        title: match.recording_name,
        artist: match.artist_credit_name,
    };
    return isSameTrack(found, search);
}

function keepSearchedMatch(
    match: ListenBrainzMatch | null,
    search: TrackSearch
): ListenBrainzMatch | null {
    if (!match) {
        return null;
    }

    return isSearchedMatch(match, search) ? match : null;
}

// Year, numbers, album artist and cover from another release would be wrong.
function getReleaseNeeds(
    match: ListenBrainzMatch,
    search: TrackSearch,
    needs: ProviderNeeds
): ReleaseNeeds {
    const release = {
        album: match.release_name,
        albumArtist: getRelease(match).album_artist_name,
        trackArtist: match.artist_credit_name,
    };
    const isRelease = isSameRelease(release, search.album);
    return {
        isRelease,
        cover: needs.cover && isRelease,
        details: needs.details && isRelease,
    };
}

function getRelease(match: ListenBrainzMatch): ListenBrainzRelease {
    return match.metadata?.release ?? {};
}

function getMatchInfo(
    match: ListenBrainzMatch,
    year: string,
    isRelease: boolean
): TrackInfo {
    return {
        title: valueOrEmpty(match.recording_name),
        artist: valueOrEmpty(match.artist_credit_name),
        album: isRelease ? valueOrEmpty(match.release_name) : "",
        year,
    };
}

function getMatchExtras(
    match: ListenBrainzMatch,
    isRelease: boolean
): TrackExtras {
    const albumArtist = optionalText(getRelease(match).album_artist_name);
    return {
        genre: pickGenre(match.metadata?.tag),
        albumArtist: isRelease ? albumArtist : undefined,
    };
}

function hasCoverArt(
    release: ListenBrainzRelease
): release is ListenBrainzRelease & CoverArt {
    return Boolean(release.caa_release_mbid && release.caa_id);
}

export class ListenBrainzProvider implements MetadataProvider {
    readonly name = "ListenBrainz";

    constructor(
        private readonly listenBrainz: ListenBrainzClient,
        private readonly musicBrainz: MusicBrainzClient,
        private readonly services: ProviderServices
    ) {}

    async findMetadata(
        search: TrackSearch,
        needs: ProviderNeeds
    ): Promise<TrackMetadata | null> {
        const match = await this.findMatch(search);

        if (!match) {
            return null;
        }

        const releaseNeeds = getReleaseNeeds(match, search, needs);
        const details = await this.findReleaseDetails(match, releaseNeeds);
        const extras = {
            ...getMatchExtras(match, releaseNeeds.isRelease),
            ...details.extras,
        };
        return {
            info: getMatchInfo(match, details.year, releaseNeeds.isRelease),
            extras: removeUnknownValues(extras),
            coverData: await this.findCover(match, releaseNeeds.cover),
        };
    }

    private async findMatch(
        search: TrackSearch
    ): Promise<ListenBrainzMatch | null> {
        if (!search.artist) {
            return null;
        }

        return keepSearchedMatch(await this.lookUp(search), search);
    }

    private async lookUp(
        search: TrackSearch
    ): Promise<ListenBrainzMatch | null> {
        try {
            return await this.listenBrainz.lookUp(search);
        } catch (error) {
            this.services.logger.error(
                `ListenBrainz lookup failed: ${getErrorMessage(error)}`
            );
            return null;
        }
    }

    private findReleaseDetails(
        match: ListenBrainzMatch,
        { details }: ReleaseNeeds
    ): Promise<ReleaseDetails> {
        const releaseId = match.release_mbid;

        if (!details || !releaseId) {
            return Promise.resolve(NO_DETAILS);
        }

        return this.loadReleaseDetails(
            releaseId,
            valueOrEmpty(match.recording_mbid)
        );
    }

    private async loadReleaseDetails(
        releaseId: string,
        recordingId: string
    ): Promise<ReleaseDetails> {
        try {
            const release = await this.musicBrainz.getRelease(releaseId);
            return {
                year: getFirstReleaseYear(release, recordingId),
                extras: getTrackPositionExtras(release, recordingId),
            };
        } catch (error) {
            this.services.logger.error(
                `MusicBrainz release lookup failed: ${getErrorMessage(error)}`
            );
            return NO_DETAILS;
        }
    }

    private findCover(
        match: ListenBrainzMatch,
        isWanted: boolean
    ): Promise<Buffer | null> {
        const request = this.getCoverRequest(getRelease(match));
        return isWanted && request
            ? this.services.images.downloadFirst([request])
            : Promise.resolve(null);
    }

    private getCoverRequest(release: ListenBrainzRelease): ImageRequest | null {
        if (!hasCoverArt(release)) {
            return null;
        }

        return this.musicBrainz.getCoverRequest(
            release.caa_release_mbid,
            String(release.caa_id)
        );
    }
}
