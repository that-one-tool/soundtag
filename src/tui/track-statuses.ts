import * as path from "node:path";
import type { ProcessedTrack, TrackStatus } from "../processing/types.js";
import type { BrowserEntry, EntryKind, TrackStatuses } from "./types.js";

const STATUS_SEVERITY: TrackStatus[] = ["TAGGED", "SKIPPED", "FAILED"];

export function recordProcessedTrack(
    statuses: TrackStatuses,
    { source, status, destination }: ProcessedTrack
): TrackStatuses {
    const updated = new Map(statuses);
    updated.delete(source);
    updated.set(destination ?? source, status);
    return updated;
}

function isInsideFolder(file: string, folder: string): boolean {
    const relative = path.relative(folder, file);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
}

function getStatusesInside(
    statuses: TrackStatuses,
    folder: string
): TrackStatus[] {
    return [...statuses]
        .filter(([file]) => isInsideFolder(file, folder))
        .map(([, status]) => status);
}

function getWorstStatus(found: TrackStatus[]): TrackStatus | undefined {
    return STATUS_SEVERITY.findLast((status) => found.includes(status));
}

const STATUS_READERS: Record<
    EntryKind,
    (statuses: TrackStatuses, entryPath: string) => TrackStatus | undefined
> = {
    file: (statuses, entryPath) => statuses.get(entryPath),
    folder: (statuses, entryPath) =>
        getWorstStatus(getStatusesInside(statuses, entryPath)),
    parent: () => undefined,
};

export function getEntryStatus(
    statuses: TrackStatuses,
    entry: BrowserEntry
): TrackStatus | undefined {
    return STATUS_READERS[entry.kind](statuses, entry.path);
}

export function countFolderStatuses(
    statuses: TrackStatuses,
    folder: string
): Record<TrackStatus, number> {
    const found = getStatusesInside(statuses, folder);
    const count = (status: TrackStatus) =>
        found.filter((foundStatus) => foundStatus === status).length;

    return {
        TAGGED: count("TAGGED"),
        SKIPPED: count("SKIPPED"),
        FAILED: count("FAILED"),
    };
}
