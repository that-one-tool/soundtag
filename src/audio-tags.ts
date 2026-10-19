import NodeID3 from "node-id3";
import {
    ByteVector,
    File as TagLibFile,
    Picture,
    PictureType,
} from "node-taglib-sharp";
import { getAudioFormat, writeTemporaryCopy } from "./file.js";
import type { TrackInfo } from "./types.js";

export async function readTrackInfo(source: string): Promise<TrackInfo> {
    const format = getAudioFormat(source);

    if (format === "mp3") {
        const tags = await NodeID3.Promise.read(source);
        return {
            title: tags.title?.trim() ?? "",
            artist: tags.artist?.trim() ?? "",
            album: tags.album?.trim() ?? "",
            year: tags.year?.trim() ?? "",
        };
    }

    if (format) {
        const file = TagLibFile.createFromPath(source);

        try {
            return {
                title: file.tag.title?.trim() ?? "",
                artist:
                    file.tag.performers.find((performer) =>
                        performer?.trim()
                    ) ?? "",
                album: file.tag.album?.trim() ?? "",
                year: file.tag.year > 0 ? String(file.tag.year) : "",
            };
        } finally {
            file.dispose();
        }
    }

    throw new Error(`Unsupported audio format: ${source}`);
}

export async function isProperlyTagged(source: string): Promise<boolean> {
    const format = getAudioFormat(source);

    if (format === "mp3") {
        const tags = await NodeID3.Promise.read(source);

        return Boolean(
            tags.title?.trim() &&
            tags.artist?.trim() &&
            tags.year?.trim() &&
            tags.image
        );
    }

    if (format) {
        const file = TagLibFile.createFromPath(source);

        try {
            return Boolean(
                file.tag.title?.trim() &&
                file.tag.performers.some((performer) => performer.trim()) &&
                file.tag.year > 0 &&
                file.tag.pictures.length > 0
            );
        } finally {
            file.dispose();
        }
    }

    throw new Error(`Unsupported audio format: ${source}`);
}

export async function tagAudio(
    source: string,
    destination: string,
    info: TrackInfo,
    coverData: Buffer | null
): Promise<void> {
    const format = getAudioFormat(source);

    if (!format) {
        throw new Error(`Unsupported audio format: ${source}`);
    }

    await writeTemporaryCopy(source, destination, async (temporary) => {
        if (format === "mp3") {
            const tags: NodeID3.Tags = {};

            if (info.title.trim()) {
                tags.title = info.title;
            }
            if (info.artist.trim()) {
                tags.artist = info.artist;
            }
            if (info.album.trim()) {
                tags.album = info.album;
            }
            if (info.year.trim()) {
                tags.year = info.year;
            }

            if (coverData) {
                tags.image = {
                    mime: "image/jpeg",
                    type: { id: 3, name: "front cover" },
                    description: "Cover",
                    imageBuffer: coverData,
                };
            }

            const success = NodeID3.update(tags, temporary);

            if (!success || success instanceof Error) {
                throw new Error("Failed to write ID3 tags.");
            }

            return;
        }

        const file = TagLibFile.createFromPath(temporary);

        try {
            if (info.title.trim()) {
                file.tag.title = info.title;
            }
            if (info.artist.trim()) {
                file.tag.performers = [info.artist];
            }
            if (info.album.trim()) {
                file.tag.album = info.album;
            }
            if (info.year.trim()) {
                file.tag.year = Number.parseInt(info.year, 10) || 0;
            }

            if (coverData) {
                file.tag.pictures = [
                    Picture.fromFullData(
                        ByteVector.fromByteArray(coverData),
                        PictureType.FrontCover,
                        "image/jpeg",
                        "Cover"
                    ),
                ];
            }

            file.save();
        } finally {
            file.dispose();
        }
    });
}
