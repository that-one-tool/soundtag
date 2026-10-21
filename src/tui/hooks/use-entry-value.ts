import { useEffect, useState, type Dispatch } from "react";
import type { TrackStatus } from "../../processing/types.js";
import { ReadPacer } from "../read-pacer.js";
import type { BrowserEntry } from "../types.js";
import type { VersionedCache } from "../versioned-cache.js";

export interface EntryRequest {
    entry: BrowserEntry | undefined;
    status: TrackStatus | undefined;
    revision: number;
}

interface ShownValue<Value> {
    entry: BrowserEntry | undefined;
    value: Value | null;
}

export interface EntryValueView<Value> extends ShownValue<Value> {
    loading: boolean;
}

interface ReadContext<Value> {
    cache: VersionedCache<Value>;
    pacer: ReadPacer;
    show: Dispatch<ShownValue<Value>>;
}

const NOTHING_SHOWN = { entry: undefined, value: null };

export function isSameEntry(
    shown: BrowserEntry | undefined,
    hovered: BrowserEntry
) {
    return shown?.kind === hovered.kind && shown.path === hovered.path;
}

function scheduleRead<Value>(
    entry: BrowserEntry,
    { cache, pacer, show }: ReadContext<Value>
): () => void {
    let cancelled = false;
    const loadValue = async () => {
        await pacer.wait(entry.path);
        if (cancelled) {
            return;
        }
        const value = await cache.read(entry);
        if (!cancelled) show({ entry, value });
    };
    void loadValue();
    return () => {
        cancelled = true;
    };
}

// Cached values show at once, then are read again in case the file changed.
function requestValue<Value>(
    { entry }: EntryRequest,
    context: ReadContext<Value>
): () => void {
    if (!entry) {
        return () => {};
    }

    const cached = context.cache.peek(entry);
    if (cached !== undefined) {
        context.show({ entry, value: cached });
    }
    return scheduleRead(entry, context);
}

function getUnshownView<Value>(
    entry: BrowserEntry,
    cache: VersionedCache<Value>,
    shown: ShownValue<Value>
): EntryValueView<Value> {
    const cached = cache.peek(entry);
    return cached === undefined
        ? { ...shown, loading: true }
        : { entry, value: cached, loading: false };
}

function getEntryValueView<Value>(
    entry: BrowserEntry | undefined,
    cache: VersionedCache<Value>,
    shown: ShownValue<Value>
): EntryValueView<Value> {
    if (!entry) {
        return { ...NOTHING_SHOWN, loading: false };
    }

    return isSameEntry(shown.entry, entry)
        ? { ...shown, entry, loading: false }
        : getUnshownView(entry, cache, shown);
}

// Keeps showing the previous value until the hovered entry's is read.
// The status and revision are part of the request so a processed or cleared
// file is read again.
export function useEntryValue<Value>(
    { entry, status, revision }: EntryRequest,
    cache: VersionedCache<Value>
): EntryValueView<Value> {
    const [shown, show] = useState<ShownValue<Value>>(NOTHING_SHOWN);
    const [pacer] = useState(() => new ReadPacer());

    useEffect(
        () => requestValue({ entry, status, revision }, { cache, pacer, show }),
        [entry, status, revision, cache, pacer]
    );

    return getEntryValueView(entry, cache, shown);
}
