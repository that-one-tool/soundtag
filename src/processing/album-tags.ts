import type { TrackInfo } from "../metadata/types.js";
import { getTagStore } from "../tags/audio-tags.js";
import type { StoredTags } from "../tags/types.js";

export type KnownTags = ReadonlyMap<string, StoredTags>;

export function normalizeTagValue(value: string): string {
    return value.normalize("NFC").trim().toLowerCase();
}

export function getAlbumKey({ artist, album }: TrackInfo): string | null {
    const fields = [artist, album].map(normalizeTagValue);
    return fields.every(Boolean) ? fields.join("\u0000") : null;
}

export async function readKnownTags(
    file: string,
    knownTags: KnownTags
): Promise<StoredTags> {
    return knownTags.get(file) ?? getTagStore(file).read(file);
}
