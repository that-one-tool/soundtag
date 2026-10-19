import * as fs from "node:fs/promises";
import { ReadStyle, File as TagLibFile, type Tag } from "node-taglib-sharp";
import { trimOrEmpty } from "../metadata/track-metadata.js";
import type { TrackDetails } from "./types.js";

type AudioDetails = Omit<TrackDetails, "sizeBytes">;

const UNKNOWN_AUDIO_DETAILS: AudioDetails = {
    trackNumber: 0,
    trackCount: 0,
    discNumber: 0,
    discCount: 0,
    genre: "",
    durationMilliseconds: 0,
    bitrateKbps: 0,
    sampleRateHz: 0,
    channels: 0,
};

type TagFields = Pick<
    AudioDetails,
    "trackNumber" | "trackCount" | "discNumber" | "discCount" | "genre"
>;

function readTagFields(tag: Tag): TagFields {
    return {
        trackNumber: tag.track,
        trackCount: tag.trackCount,
        discNumber: tag.disc,
        discCount: tag.discCount,
        genre: trimOrEmpty(tag.firstGenre),
    };
}

function readTagLibDetails({ tag, properties }: TagLibFile): AudioDetails {
    return {
        ...readTagFields(tag),
        durationMilliseconds: properties.durationMilliseconds,
        bitrateKbps: properties.audioBitrate,
        sampleRateHz: properties.audioSampleRate,
        channels: properties.audioChannels,
    };
}

function readTagLibFile(
    source: string,
    readStyle: ReadStyle,
    read: (file: TagLibFile) => AudioDetails
): AudioDetails {
    const file = TagLibFile.createFromPath(source, undefined, readStyle);

    try {
        return read(file);
    } finally {
        file.dispose();
    }
}

function readTagsOnly(source: string): AudioDetails {
    return readTagLibFile(source, ReadStyle.None, (file) => ({
        ...UNKNOWN_AUDIO_DETAILS,
        ...readTagFields(file.tag),
    }));
}

// Files without a parsable audio stream still have tags worth showing.
function readAudioDetails(source: string): AudioDetails {
    const readStyle = ReadStyle.Average | ReadStyle.PictureLazy;
    try {
        return readTagLibFile(source, readStyle, readTagLibDetails);
    } catch {
        return readTagsOrUnknown(source);
    }
}

function readTagsOrUnknown(source: string): AudioDetails {
    try {
        return readTagsOnly(source);
    } catch {
        return UNKNOWN_AUDIO_DETAILS;
    }
}

export async function readTrackDetails(source: string): Promise<TrackDetails> {
    const { size } = await fs.stat(source);
    return { ...readAudioDetails(source), sizeBytes: size };
}
