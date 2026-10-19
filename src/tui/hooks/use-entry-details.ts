import { useEffect, useState, type Dispatch } from "react";
import type { TrackStatus } from "../../processing/types.js";
import type { DetailsCache } from "../details-cache.js";
import type { ReadPacer } from "../read-pacer.js";
import type { BrowserEntry, EntryDetails } from "../types.js";

export interface DetailsRequest {
    entry: BrowserEntry | undefined;
    status: TrackStatus | undefined;
}

export interface DetailsSources {
    detailsCache: DetailsCache;
    readPacer: ReadPacer;
}

interface ShownDetails {
    entry: BrowserEntry | undefined;
    details: EntryDetails | null;
}

export interface DetailsView extends ShownDetails {
    loading: boolean;
}

interface ReadContext extends DetailsSources {
    show: Dispatch<ShownDetails>;
}

const NO_DETAILS: ShownDetails = { entry: undefined, details: null };

function isSameEntry(shown: BrowserEntry | undefined, hovered: BrowserEntry) {
    return shown?.kind === hovered.kind && shown.path === hovered.path;
}

function scheduleRead(entry: BrowserEntry, context: ReadContext): () => void {
    let cancelled = false;
    const loadDetails = async () => {
        await context.readPacer.wait(entry.path);
        if (cancelled) {
            return;
        }
        const details = await context.detailsCache.read(entry);
        if (!cancelled) context.show({ entry, details });
    };
    void loadDetails();
    return () => {
        cancelled = true;
    };
}

// Cached details show at once, then are read again in case the file changed.
function requestDetails(
    { entry }: DetailsRequest,
    context: ReadContext
): () => void {
    if (!entry) {
        return () => {};
    }

    const cached = context.detailsCache.peek(entry);
    if (cached) {
        context.show({ entry, details: cached });
    }
    return scheduleRead(entry, context);
}

function getUnshownView(
    entry: BrowserEntry,
    cache: DetailsCache,
    shown: ShownDetails
): DetailsView {
    const cached = cache.peek(entry);
    return cached
        ? { entry, details: cached, loading: false }
        : { ...shown, loading: true };
}

function getDetailsView(
    entry: BrowserEntry | undefined,
    cache: DetailsCache,
    shown: ShownDetails
): DetailsView {
    if (!entry) {
        return { ...NO_DETAILS, loading: false };
    }

    return isSameEntry(shown.entry, entry)
        ? { ...shown, entry, loading: false }
        : getUnshownView(entry, cache, shown);
}

// Keeps showing the previous details until the hovered entry's are read.
// The status is part of the request so a processed file's new tags are re-read.
export function useEntryDetails(
    { entry, status }: DetailsRequest,
    { detailsCache, readPacer }: DetailsSources
): DetailsView {
    const [shown, show] = useState<ShownDetails>(NO_DETAILS);

    useEffect(
        () =>
            requestDetails(
                { entry, status },
                { detailsCache, readPacer, show }
            ),
        [entry, status, detailsCache, readPacer]
    );

    return getDetailsView(entry, detailsCache, shown);
}
