import { isInsideFolder, movePath, type PathMove } from "../shared/paths.js";
import type { ProcessedTrack, TrackStatus } from "../processing/types.js";
import type { BrowserEntry, EntryKind, TrackStatuses } from "./types.js";

// Ordered from least to most severe.
export const STATUS_ORDER: TrackStatus[] = ["TAGGED", "SKIPPED", "FAILED"];

export function recordProcessedTrack(
    statuses: TrackStatuses,
    { source, status }: ProcessedTrack
): TrackStatuses {
    return new Map(statuses).set(source, status);
}

export function moveStatuses(
    statuses: TrackStatuses,
    move: PathMove
): TrackStatuses {
    return new Map(
        [...statuses].map(([file, status]) => [movePath(file, move), status])
    );
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
    return STATUS_ORDER.findLast((status) => found.includes(status));
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

function countEachStatus(found: TrackStatus[]): Record<TrackStatus, number> {
    const count = (status: TrackStatus) =>
        found.filter((foundStatus) => foundStatus === status).length;

    return {
        TAGGED: count("TAGGED"),
        SKIPPED: count("SKIPPED"),
        FAILED: count("FAILED"),
    };
}

export function countStatuses(
    statuses: TrackStatuses
): Record<TrackStatus, number> {
    return countEachStatus([...statuses.values()]);
}

export function countFolderStatuses(
    statuses: TrackStatuses,
    folder: string
): Record<TrackStatus, number> {
    return countEachStatus(getStatusesInside(statuses, folder));
}
