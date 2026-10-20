import type { StoredTags, TrackDetails } from "../tags/types.js";
import type { TrackStatus } from "../processing/types.js";

export interface CoverArt {
    width: number;
    height: number;
    pixels: Uint8Array;
}

// Sized like a full half-block cover, so both fill the same cell box.
export interface PngCover {
    png: Buffer;
    key: string;
    width: number;
    height: number;
}

export type CoverPicture = CoverArt | PngCover;

export interface CoverSpot {
    row: number;
    column: number;
    columns: number;
    rows: number;
}

export type CoverLookup =
    | { kind: "found"; art: CoverPicture }
    | { kind: "missing" }
    | { kind: "unreadable" };

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

export type EntryDot = TrackStatus | "QUEUED";

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

export interface DotSources {
    queue: QueueState;
    statuses: TrackStatuses;
    redoneFiles: ReadonlySet<string>;
}
