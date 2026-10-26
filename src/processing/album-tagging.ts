import * as path from "node:path";
import { parseLibraryPath } from "../library/library-path.js";
import { parseTrackFilename } from "../library/track-name-parser.js";
import type { AlbumTrack } from "../library/types.js";
import { findTracklistEntry } from "../metadata/album-tracklist.js";
import {
    getFirstFilled,
    optionalText,
    removeUnknownValues,
} from "../metadata/track-metadata.js";
import type {
    AlbumData,
    AlbumTrackEntry,
    TrackExtras,
    TrackMetadata,
} from "../metadata/types.js";
import type { StoredTags } from "../tags/types.js";
import { formatSkipLine } from "./track-log.js";
import { failOnError, readTrack, writeFoundMetadata } from "./track-write.js";
import type { ProcessingContext, TrackStatus } from "./types.js";

function getFileTitle(file: string): string {
    const pathTerms = parseLibraryPath(file);
    return pathTerms?.title ?? parseTrackFilename(path.basename(file)).title;
}

function getPositionExtras(
    entry: AlbumTrackEntry | undefined,
    disc: number | null
): TrackExtras {
    if (!entry) {
        return { discNumber: disc ?? undefined };
    }

    const { trackNumber, trackCount, discNumber, discCount } = entry;
    return { trackNumber, trackCount, discNumber, discCount };
}

function getAlbumExtras(
    album: AlbumData,
    entry: AlbumTrackEntry | undefined,
    disc: number | null
): TrackExtras {
    return removeUnknownValues({
        genre: optionalText(album.genre),
        albumArtist: optionalText(album.artist),
        ...getPositionExtras(entry, disc),
    });
}

function findTrackEntry(
    album: AlbumData,
    track: AlbumTrack,
    title: string
): AlbumTrackEntry | undefined {
    const titles = [title, getFileTitle(track.path)];
    return findTracklistEntry(album.tracks, { titles, disc: track.disc });
}

// Every track takes the album's fields; only its title and place are its own.
export function buildAlbumTrack(
    album: AlbumData,
    track: AlbumTrack,
    stored: StoredTags
): TrackMetadata {
    const title = getFirstFilled(stored.info.title, getFileTitle(track.path));
    const entry = findTrackEntry(album, track, title);
    const { artist, year } = album;
    return {
        info: {
            title: entry?.title ?? title,
            artist,
            album: album.album,
            year,
        },
        extras: getAlbumExtras(album, entry, track.disc),
        coverData: album.cover,
    };
}

// Looked up for the first track that needs it, so a tagged album costs nothing.
export type AlbumSupply = () => Promise<AlbumData>;

async function tagReadTrack(
    track: AlbumTrack,
    getAlbum: AlbumSupply,
    context: ProcessingContext
): Promise<TrackStatus> {
    const read = await readTrack(track.path, context);

    if (read.policy.skipsTaggedTrack(read.stored)) {
        context.logger.info(formatSkipLine("already tagged"));
        return "SKIPPED";
    }

    const found = buildAlbumTrack(await getAlbum(), track, read.stored);
    const kept = read.policy.keepStored(read.stored, found);
    return writeFoundMetadata(read, kept, context.logger);
}

export function tagAlbumTrack(
    track: AlbumTrack,
    getAlbum: AlbumSupply,
    context: ProcessingContext
): Promise<TrackStatus> {
    return failOnError(
        () => tagReadTrack(track, getAlbum, context),
        context.logger
    );
}
