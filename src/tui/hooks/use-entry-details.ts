import { useEffect, useState } from "react";
import type { TrackStatus } from "../../processing/types.js";
import { readEntryDetails } from "../entry-details.js";
import type { BrowserEntry, EntryDetails } from "../types.js";

// Waits for the cursor to settle so scrolling does not read every file's tags.
const DETAILS_DELAY_MILLISECONDS = 80;

interface DetailsRequest {
    entry: BrowserEntry | undefined;
    status: TrackStatus | undefined;
}

interface LoadedDetails extends DetailsRequest {
    details: EntryDetails | null;
}

function scheduleDetailsRead(
    { entry, status }: DetailsRequest,
    onLoaded: (loaded: LoadedDetails) => void
): () => void {
    if (!entry) {
        return () => {};
    }

    let cancelled = false;
    const timer = setTimeout(() => {
        void readEntryDetails(entry).then(
            (details) => !cancelled && onLoaded({ entry, status, details })
        );
    }, DETAILS_DELAY_MILLISECONDS);
    return () => {
        cancelled = true;
        clearTimeout(timer);
    };
}

function isLoadedFor(loaded: LoadedDetails, request: DetailsRequest): boolean {
    return loaded.entry === request.entry && loaded.status === request.status;
}

// The status is part of the request so a processed file's new tags are re-read.
export function useEntryDetails(
    entry: BrowserEntry | undefined,
    status: TrackStatus | undefined
): EntryDetails | null {
    const [loaded, setLoaded] = useState<LoadedDetails>({
        entry: undefined,
        status: undefined,
        details: null,
    });

    useEffect(
        () => scheduleDetailsRead({ entry, status }, setLoaded),
        [entry, status]
    );

    return isLoadedFor(loaded, { entry, status }) ? loaded.details : null;
}
