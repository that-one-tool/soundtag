import { getTagStore } from "../tags/audio-tags.js";
import type { StoredTags } from "../tags/types.js";

function hasCoverToCompare(
    tags: StoredTags,
    cover: Buffer | null
): cover is Buffer {
    return tags.hasCover && cover !== null;
}

// Replacing covers finds one even for a file that has one, often the same image.
export async function isStoredCover(
    source: string,
    tags: StoredTags,
    cover: Buffer | null
): Promise<boolean> {
    if (!hasCoverToCompare(tags, cover)) {
        return false;
    }

    const stored = await getTagStore(source).readCover(source);
    return Boolean(stored?.equals(cover));
}
