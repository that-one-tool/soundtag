import NodeID3 from "node-id3";
import { writeTemporaryCopy } from "./file.js";
import { getImageMimeType } from "./image-type.js";
import { getFilledFields, trimOrEmpty } from "./track-metadata.js";
import type { StoredTags, TagStore, TrackMetadata } from "./types.js";

function buildCoverImage(coverData: Buffer): NodeID3.Tags["image"] {
    return {
        mime: getImageMimeType(coverData),
        type: { id: 3, name: "front cover" },
        description: "Cover",
        imageBuffer: coverData,
    };
}

function buildId3Tags({ info, coverData }: TrackMetadata): NodeID3.Tags {
    return {
        ...getFilledFields(info),
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
            hasCover: Boolean(tags.image),
        };
    }

    async write(source: string, metadata: TrackMetadata): Promise<void> {
        await writeTemporaryCopy(source, source, async (temporary) =>
            updateId3Tags(buildId3Tags(metadata), temporary)
        );
    }
}
