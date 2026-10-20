import type { TrackStatus } from "../processing/types.js";
import type { EntryDot } from "./types.js";

export const ACCENT = "cyan";
export const ERROR_COLOR = "red";
export const FOLDER_COLOR = "blue";
export const SELECTION_MARKER = "▸";
export const SELECTION_TEXT = "black";
export const STATUS_GLYPH = "●";

export const PANE_COLOR = {
    browser: ACCENT,
    metadata: "magenta",
    log: "gray",
} as const;

export const STATUS_COLOR: Record<TrackStatus, string> = {
    TAGGED: "green",
    SKIPPED: "yellow",
    FAILED: "red",
};

export const DOT_COLOR: Record<EntryDot, string> = {
    ...STATUS_COLOR,
    QUEUED: "gray",
};
