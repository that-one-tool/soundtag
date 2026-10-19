import { getAudioFormat, type AudioFormat } from "../library/file.js";
import { Id3TagStore } from "./id3-tag-store.js";
import { TagLibTagStore } from "./taglib-tag-store.js";
import type { StoredTags, TagStore } from "./types.js";

const id3TagStore = new Id3TagStore();
const tagLibTagStore = new TagLibTagStore();
const TAG_STORES: Record<AudioFormat, TagStore> = {
    mp3: id3TagStore,
    ogg: tagLibTagStore,
    flac: tagLibTagStore,
    wav: tagLibTagStore,
};

export function getTagStore(source: string): TagStore {
    const format = getAudioFormat(source);

    if (!format) {
        throw new Error(`Unsupported audio format: ${source}`);
    }

    return TAG_STORES[format];
}

export function hasCoreTags({ info, hasCover }: StoredTags): boolean {
    const requiredFields = [info.title, info.artist, info.year];
    return hasCover && requiredFields.every((field) => field.trim());
}

export function isProperlyTagged(tags: StoredTags): boolean {
    return hasCoreTags(tags) && Boolean(tags.extras.genre);
}
