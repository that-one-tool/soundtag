import * as path from "node:path";
import type { BrowserEntry, BrowserListing } from "./types.js";

export interface BrowserState {
    directory: string;
    entries: BrowserEntry[];
    cursor: number;
    focusPath?: string;
    error?: string;
}

export type BrowserAction =
    | { type: "loaded"; directory: string; listing: BrowserListing }
    | { type: "move"; delta: number }
    | { type: "open" }
    | { type: "parent" };

export function createBrowserState(directory: string): BrowserState {
    return { directory, entries: [], cursor: 0 };
}

function getHoveredPath(state: BrowserState): string | undefined {
    return state.entries[state.cursor]?.path;
}

function clampCursor(cursor: number, entryCount: number): number {
    return Math.max(0, Math.min(cursor, entryCount - 1));
}

function selectCursor(state: BrowserState, entries: BrowserEntry[]): number {
    const focusPath = state.focusPath ?? getHoveredPath(state);
    const focusIndex = entries.findIndex((entry) => entry.path === focusPath);
    return focusIndex >= 0
        ? focusIndex
        : clampCursor(state.cursor, entries.length);
}

function getEntryKey({ kind, path: entryPath }: BrowserEntry): string {
    return `${kind}:${entryPath}`;
}

// Keeping unchanged entries stable avoids re-reading the hovered entry's details.
function reuseEntries(
    previous: BrowserEntry[],
    loaded: BrowserEntry[]
): BrowserEntry[] {
    const known = new Map(previous.map((entry) => [getEntryKey(entry), entry]));
    return loaded.map((entry) => known.get(getEntryKey(entry)) ?? entry);
}

function applyLoaded(
    state: BrowserState,
    { entries, error }: BrowserListing
): BrowserState {
    return {
        directory: state.directory,
        entries: reuseEntries(state.entries, entries),
        cursor: selectCursor(state, entries),
        error,
    };
}

function applyListing(
    state: BrowserState,
    { directory, listing }: Extract<BrowserAction, { type: "loaded" }>
): BrowserState {
    return directory === state.directory ? applyLoaded(state, listing) : state;
}

function goToParent(state: BrowserState): BrowserState {
    const parent = path.dirname(state.directory);

    if (parent === state.directory) {
        return state;
    }

    return { ...createBrowserState(parent), focusPath: state.directory };
}

const OPENERS: Record<
    BrowserEntry["kind"],
    (state: BrowserState, entry: BrowserEntry) => BrowserState
> = {
    folder: (_state, entry) => createBrowserState(entry.path),
    parent: (state) => goToParent(state),
    file: (state) => state,
};

function openHovered(state: BrowserState): BrowserState {
    const hovered = state.entries[state.cursor];
    return hovered ? OPENERS[hovered.kind](state, hovered) : state;
}

const REDUCERS: {
    [Type in BrowserAction["type"]]: (
        state: BrowserState,
        action: Extract<BrowserAction, { type: Type }>
    ) => BrowserState;
} = {
    loaded: applyListing,
    move: (state, { delta }) => ({
        ...state,
        cursor: clampCursor(state.cursor + delta, state.entries.length),
    }),
    open: openHovered,
    parent: goToParent,
};

export function reduceBrowserState(
    state: BrowserState,
    action: BrowserAction
): BrowserState {
    const reducer = REDUCERS[action.type] as (
        state: BrowserState,
        action: BrowserAction
    ) => BrowserState;
    return reducer(state, action);
}
