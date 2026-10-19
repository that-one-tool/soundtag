import { findLastFmMetadata } from "./lastfm.js";
import { findItunesMetadata } from "./itunes.js";
import { findMusicBrainzMetadata } from "./musicbrainz.js";
import { findYouTubeThumbnail } from "./youtube.js";
import type { TrackInfo, TrackMetadata } from "./types.js";

export { isProperlyTagged, tagAudio } from "./audio-tags.js";

let musicBrainzConfigurationWarningLogged = false;

export async function findTrackMetadata(
    query: string,
    apiKey: string,
    searchArtist?: string,
    verbose = false,
    musicBrainzUserAgent?: string,
    youtubeApiKey?: string,
    searchContext?: { album?: string; existingInfo?: TrackInfo }
): Promise<TrackMetadata | null> {
    const lastFmMetadata = await findLastFmMetadata(
        query,
        apiKey,
        searchArtist,
        verbose
    );
    const info: TrackInfo = {
        title: searchContext?.existingInfo?.title ?? "",
        artist: searchContext?.existingInfo?.artist ?? "",
        album: searchContext?.existingInfo?.album ?? "",
        year: searchContext?.existingInfo?.year ?? "",
    };
    if (lastFmMetadata) {
        info.title = info.title.trim() || lastFmMetadata.info.title;
        info.artist = info.artist.trim() || lastFmMetadata.info.artist;
        info.album = info.album.trim() || lastFmMetadata.info.album;
        info.year = info.year.trim() || lastFmMetadata.info.year;
    }
    let coverData = lastFmMetadata?.coverData ?? null;

    if (!lastFmMetadata) {
        console.log("Album: ");
        console.log("Year: ");
    }

    let musicBrainzMetadata: Awaited<
        ReturnType<typeof findMusicBrainzMetadata>
    > = null;
    const musicBrainzAgent = musicBrainzUserAgent?.trim();

    if (
        !info.title.trim() ||
        !info.artist.trim() ||
        !info.album.trim() ||
        !info.year.trim() ||
        !coverData
    ) {
        if (musicBrainzAgent) {
            musicBrainzMetadata = await findMusicBrainzMetadata(
                info.title || query,
                info.artist || searchArtist || "",
                musicBrainzAgent,
                !coverData,
                searchContext?.album || info.album
            );
        } else if (!musicBrainzConfigurationWarningLogged) {
            console.error(
                "MusicBrainz fallback requires MUSICBRAINZ_USER_AGENT."
            );
            musicBrainzConfigurationWarningLogged = true;
        }
    }

    if (musicBrainzMetadata) {
        info.title =
            info.title.trim() || musicBrainzMetadata.info.title || query;
        info.artist =
            info.artist.trim() ||
            musicBrainzMetadata.info.artist ||
            searchArtist ||
            "";
        info.album = info.album.trim() || musicBrainzMetadata.info.album || "";
        info.year = info.year.trim() || musicBrainzMetadata.info.year || "";
        coverData = coverData ?? musicBrainzMetadata.coverData;
    }

    let itunesMetadata: Awaited<ReturnType<typeof findItunesMetadata>> = null;

    if (
        !info.title.trim() ||
        !info.artist.trim() ||
        !info.album.trim() ||
        !info.year.trim() ||
        !coverData
    ) {
        itunesMetadata = await findItunesMetadata(
            info.title || query,
            info.artist || searchArtist || "",
            searchContext?.album || info.album
        );

        if (itunesMetadata) {
            info.title = info.title.trim() || itunesMetadata.info.title;
            info.artist = info.artist.trim() || itunesMetadata.info.artist;
            info.album = info.album.trim() || itunesMetadata.info.album;
            info.year = info.year.trim() || itunesMetadata.info.year;
            coverData = coverData ?? itunesMetadata.coverData;
        }
    }

    if (!lastFmMetadata && !musicBrainzMetadata && !itunesMetadata) {
        return null;
    }

    const youtubeKey = youtubeApiKey?.trim();
    if (!coverData && youtubeKey) {
        coverData = await findYouTubeThumbnail(
            info.title || query,
            info.artist || searchArtist || "",
            youtubeKey
        );
    }

    console.log(`Cover: ${coverData ? "downloaded" : "unavailable"}`);

    return { info, coverData };
}
