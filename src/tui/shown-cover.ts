import { isSameEntry, type EntryValueView } from "./hooks/use-entry-value.js";
import type { BrowserEntry, CoverArt, CoverLookup } from "./types.js";

type CoverView = EntryValueView<CoverLookup>;

function getFoundArt(lookup: CoverLookup | null): CoverArt | null {
    return lookup?.kind === "found" ? lookup.art : null;
}

function getCoverOf(cover: CoverView, entry: BrowserEntry): CoverArt | null {
    return isSameEntry(cover.entry, entry) ? getFoundArt(cover.value) : null;
}

// A cover only shows beside the details of its own entry.
export function getShownCover(
    detailsEntry: BrowserEntry | undefined,
    cover: CoverView
): CoverArt | null {
    return detailsEntry ? getCoverOf(cover, detailsEntry) : null;
}
