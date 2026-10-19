import {
    ByteVector,
    Picture,
    PictureType,
    File as TagLibFile,
    type Tag,
} from "node-taglib-sharp";
import { writeTemporaryCopy } from "../library/file.js";
import { getImageMimeType } from "./image-type.js";
import { TRACK_FIELDS, trimOrEmpty } from "../metadata/track-metadata.js";
import type { TrackInfo, TrackMetadata } from "../metadata/types.js";
import type { StoredTags, TagStore } from "./types.js";

type FieldWriter = (tag: Tag, value: string) => void;

const FIELD_WRITERS: Record<keyof TrackInfo, FieldWriter> = {
    title: (tag, value) => {
        tag.title = value;
    },
    artist: (tag, value) => {
        tag.performers = [value];
    },
    album: (tag, value) => {
        tag.album = value;
    },
    year: (tag, value) => {
        tag.year = Number.parseInt(value, 10) || 0;
    },
};

function useTagLibFile<T>(source: string, use: (file: TagLibFile) => T): T {
    const file = TagLibFile.createFromPath(source);

    try {
        return use(file);
    } finally {
        file.dispose();
    }
}

function getFirstPerformer(performers: string[]): string {
    const trimmedPerformers = performers.map((performer) => performer.trim());
    return trimmedPerformers.find(Boolean) ?? "";
}

function formatYear(year: number): string {
    return year > 0 ? String(year) : "";
}

function readTagLibInfo(tag: Tag): TrackInfo {
    return {
        title: trimOrEmpty(tag.title),
        artist: getFirstPerformer(tag.performers),
        album: trimOrEmpty(tag.album),
        year: formatYear(tag.year),
    };
}

function writeFilledFields(tag: Tag, info: TrackInfo): void {
    const fields = TRACK_FIELDS.filter((field) => info[field].trim());

    for (const field of fields) {
        FIELD_WRITERS[field](tag, info[field]);
    }
}

function buildCoverPicture(coverData: Buffer): Picture {
    return Picture.fromFullData(
        ByteVector.fromByteArray(coverData),
        PictureType.FrontCover,
        getImageMimeType(coverData),
        "Cover"
    );
}

function writeTagLibMetadata(
    file: TagLibFile,
    { info, coverData }: TrackMetadata
): void {
    writeFilledFields(file.tag, info);

    if (coverData) {
        file.tag.pictures = [buildCoverPicture(coverData)];
    }

    file.save();
}

export class TagLibTagStore implements TagStore {
    async read(source: string): Promise<StoredTags> {
        return useTagLibFile(source, (file) => ({
            info: readTagLibInfo(file.tag),
            hasCover: file.tag.pictures.length > 0,
        }));
    }

    async write(source: string, metadata: TrackMetadata): Promise<void> {
        await writeTemporaryCopy(source, source, async (temporary) =>
            useTagLibFile(temporary, (file) =>
                writeTagLibMetadata(file, metadata)
            )
        );
    }
}
