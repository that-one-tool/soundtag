import type { StoredTags, TrackDetails } from "../tags/types.js";
import type { TrackStatus } from "../processing/types.js";

export type FocusedPane = "browser" | "log";

export type EntryKind = "parent" | "folder" | "file";

export interface BrowserEntry {
    name: string;
    path: string;
    kind: EntryKind;
}

export interface BrowserListing {
    entries: BrowserEntry[];
    error?: string;
}

export type TrackStatuses = ReadonlyMap<string, TrackStatus>;

export type TagTarget =
    | { kind: "file"; path: string }
    | { kind: "folder"; path: string; recursive: boolean };

export type TagJobRunner = (
    target: TagTarget,
    stopSignal: AbortSignal
) => Promise<boolean>;

export interface QueueState {
    running: TagTarget | null;
    pending: TagTarget[];
    stopping: boolean;
    failed: boolean;
}

export type EntryDetails =
    | {
          kind: "file";
          format: string;
          tags: StoredTags;
          track: TrackDetails;
      }
    | { kind: "folder"; audioFileCount: number; subfolderCount: number }
    | { kind: "unreadable"; message: string }
    | { kind: "parent" };

export type TuiOutcome = "success" | "failure" | "forced";
