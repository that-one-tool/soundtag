import NodeID3 from "node-id3";
import { writeTemporaryCopy } from "../library/file.js";
import { getImageMimeType } from "./image-type.js";
import {
    getFilledFields,
    optionalCount,
    optionalText,
    removeUnknownValues,
    trimOrEmpty,
    valueOrEmpty,
} from "../metadata/track-metadata.js";
import type { TrackExtras, TrackMetadata } from "../metadata/types.js";
import type { StoredTags, TagStore } from "./types.js";

function buildCoverImage(coverData: Buffer): NodeID3.Tags["image"] {
    return {
        mime: getImageMimeType(coverData),
        type: { id: 3, name: "front cover" },
        description: "Cover",
        imageBuffer: coverData,
    };
}

type Position = [number | undefined, number | undefined];

function parseCount(text: string | undefined): number | undefined {
    return optionalCount(Number.parseInt(valueOrEmpty(text), 10));
}

// ID3 stores positions as "number/count", e.g. TRCK "6/10".
function parsePosition(text: string | undefined): Position {
    const [position, count] = valueOrEmpty(text).split("/");
    return [parseCount(position), parseCount(count)];
}

function formatPosition(
    position: number | undefined,
    count: number | undefined
): string | undefined {
    if (!position) {
        return undefined;
    }

    return count ? `${position}/${count}` : String(position);
}

function readId3Extras(tags: NodeID3.Tags): TrackExtras {
    const [trackNumber, trackCount] = parsePosition(tags.trackNumber);
    const [discNumber, discCount] = parsePosition(tags.partOfSet);
    return removeUnknownValues({
        genre: optionalText(tags.genre),
        albumArtist: optionalText(tags.performerInfo),
        trackNumber,
        trackCount,
        discNumber,
        discCount,
    });
}

function buildId3Extras(extras: TrackExtras): NodeID3.Tags {
    return removeUnknownValues({
        genre: extras.genre,
        performerInfo: extras.albumArtist,
        trackNumber: formatPosition(extras.trackNumber, extras.trackCount),
        partOfSet: formatPosition(extras.discNumber, extras.discCount),
    });
}

function buildId3Tags({
    info,
    extras,
    coverData,
}: TrackMetadata): NodeID3.Tags {
    return {
        ...getFilledFields(info),
        ...buildId3Extras(extras),
        ...(coverData ? { image: buildCoverImage(coverData) } : {}),
    };
}

function updateId3Tags(tags: NodeID3.Tags, source: string): void {
    const result = NodeID3.update(tags, source);

    if (!result || result instanceof Error) {
        throw new Error("Failed to write ID3 tags.");
    }
}

export class Id3TagStore implements TagStore {
    async read(source: string): Promise<StoredTags> {
        const tags = await NodeID3.Promise.read(source);

        return {
            info: {
                title: trimOrEmpty(tags.title),
                artist: trimOrEmpty(tags.artist),
                album: trimOrEmpty(tags.album),
                year: trimOrEmpty(tags.year),
            },
            extras: readId3Extras(tags),
            hasCover: Boolean(tags.image),
        };
    }

    async write(source: string, metadata: TrackMetadata): Promise<void> {
        await writeTemporaryCopy(source, source, async (temporary) =>
            updateId3Tags(buildId3Tags(metadata), temporary)
        );
    }
}
