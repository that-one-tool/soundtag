import { isEntryTargeted } from "./tag-target.js";
import { getEntryStatus } from "./track-statuses.js";
import type { BrowserEntry, DotSources, EntryDot } from "./types.js";

function isAwaitingRunningJob(
    sources: DotSources,
    entry: BrowserEntry
): boolean {
    const { running } = sources.queue;
    return (
        running !== null &&
        isEntryTargeted(running, entry) &&
        !sources.redoneFiles.has(entry.path)
    );
}

function isEntryQueued(sources: DotSources, entry: BrowserEntry): boolean {
    return (
        sources.queue.pending.some((target) =>
            isEntryTargeted(target, entry)
        ) || isAwaitingRunningJob(sources, entry)
    );
}

export function getEntryDot(
    sources: DotSources,
    entry: BrowserEntry
): EntryDot | undefined {
    return isEntryQueued(sources, entry)
        ? "QUEUED"
        : getEntryStatus(sources.statuses, entry);
}
