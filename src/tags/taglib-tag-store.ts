import {
    ByteVector,
    Picture,
    PictureType,
    ReadStyle,
    File as TagLibFile,
    TagTypes,
    type Tag,
} from "node-taglib-sharp";
import { writeTemporaryCopy } from "../library/file.js";
import { getImageMimeType } from "./image-type.js";
import {
    optionalCount,
    optionalText,
    removeUnknownValues,
    TRACK_FIELDS,
    trimOrEmpty,
} from "../metadata/track-metadata.js";
import type {
    TrackExtras,
    TrackInfo,
    TrackMetadata,
} from "../metadata/types.js";
import type { StoredTags, TagStore } from "./types.js";

type FieldWriter = (tag: Tag, value: string) => void;

// Only the first filled performer is read, so it alone is replaced.
function replaceLeadPerformer(performers: string[], artist: string) {
    const others = performers.filter((performer) => performer.trim());
    return [artist, ...others.slice(1)];
}

const FIELD_WRITERS: Record<keyof TrackInfo, FieldWriter> = {
    title: (tag, value) => {
        tag.title = value;
    },
    artist: (tag, value) => {
        tag.performers = replaceLeadPerformer(tag.performers, value);
    },
    album: (tag, value) => {
        tag.album = value;
    },
    year: (tag, value) => {
        tag.year = Number.parseInt(value, 10) || 0;
    },
};

type ExtraWriter = (tag: Tag, extras: TrackExtras) => void;

const EXTRA_WRITERS: readonly ExtraWriter[] = [
    (tag, { genre }) => {
        if (genre !== undefined) tag.genres = [genre];
    },
    (tag, { albumArtist }) => {
        if (albumArtist !== undefined) tag.albumArtists = [albumArtist];
    },
    (tag, { trackNumber }) => {
        if (trackNumber !== undefined) tag.track = trackNumber;
    },
    (tag, { trackCount }) => {
        if (trackCount !== undefined) tag.trackCount = trackCount;
    },
    (tag, { discNumber }) => {
        if (discNumber !== undefined) tag.disc = discNumber;
    },
    (tag, { discCount }) => {
        if (discCount !== undefined) tag.discCount = discCount;
    },
];

// Tags need neither the audio properties nor the picture bytes up front.
const TAGS_ONLY = ReadStyle.None | ReadStyle.PictureLazy;

function useTagLibFile<T>(
    source: string,
    use: (file: TagLibFile) => T,
    readStyle?: ReadStyle
): T {
    const file = TagLibFile.createFromPath(source, undefined, readStyle);

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

function readTagLibExtras(tag: Tag): TrackExtras {
    return removeUnknownValues({
        genre: optionalText(tag.firstGenre),
        albumArtist: optionalText(tag.firstAlbumArtist),
        trackNumber: optionalCount(tag.track),
        trackCount: optionalCount(tag.trackCount),
        discNumber: optionalCount(tag.disc),
        discCount: optionalCount(tag.discCount),
    });
}

function writeKnownExtras(tag: Tag, extras: TrackExtras): void {
    for (const writeExtra of EXTRA_WRITERS) {
        writeExtra(tag, extras);
    }
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

function readFirstPicture(tag: Tag): Buffer | null {
    const [picture] = tag.pictures;
    return picture ? Buffer.from(picture.data.toByteArray()) : null;
}

function removeAllTags(file: TagLibFile): void {
    file.removeTags(TagTypes.AllTags);
    file.save();
}

function writeTagLibMetadata(
    file: TagLibFile,
    { info, extras, coverData }: TrackMetadata
): void {
    writeFilledFields(file.tag, info);
    writeKnownExtras(file.tag, extras);

    if (coverData) {
        file.tag.pictures = [buildCoverPicture(coverData)];
    }

    file.save();
}

export class TagLibTagStore implements TagStore {
    async read(source: string): Promise<StoredTags> {
        return useTagLibFile(
            source,
            (file) => ({
                info: readTagLibInfo(file.tag),
                extras: readTagLibExtras(file.tag),
                hasCover: file.tag.pictures.length > 0,
            }),
            TAGS_ONLY
        );
    }

    async readCover(source: string): Promise<Buffer | null> {
        return useTagLibFile(
            source,
            ({ tag }) => readFirstPicture(tag),
            TAGS_ONLY
        );
    }

    async write(source: string, metadata: TrackMetadata): Promise<void> {
        await writeTemporaryCopy(source, source, async (temporary) =>
            useTagLibFile(temporary, (file) =>
                writeTagLibMetadata(file, metadata)
            )
        );
    }
}

// TagLib also strips ID3v1, APE and repeated ID3v2 tags, which node-id3
// leaves behind, so every format is cleared through it.
export async function clearAllTags(source: string): Promise<void> {
    await writeTemporaryCopy(source, source, async (temporary) =>
        useTagLibFile(temporary, removeAllTags, ReadStyle.None)
    );
}
