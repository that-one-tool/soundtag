import { useEffect, useReducer, type Dispatch } from "react";
import { readBrowserEntries } from "../browser-entries.js";
import {
    createBrowserState,
    reduceBrowserState,
    type BrowserAction,
    type BrowserState,
} from "../browser-state.js";
import type { PathMoves } from "../path-moves.js";
import type { ExternalStore } from "./use-store.js";

interface ListingLoader {
    load(): void;
    cancel(): void;
}

function createListingLoader(
    directory: string,
    dispatch: Dispatch<BrowserAction>
): ListingLoader {
    let latestRequest = 0;
    const load = () => {
        const request = ++latestRequest;
        void readBrowserEntries(directory).then((listing) => {
            if (request === latestRequest) {
                dispatch({ type: "loaded", directory, listing });
            }
        });
    };
    return { load, cancel: () => (latestRequest = -1) };
}

function watchListing(
    directory: string,
    changes: ExternalStore<unknown>,
    dispatch: Dispatch<BrowserAction>
): () => void {
    const loader = createListingLoader(directory, dispatch);
    loader.load();
    const unsubscribe = changes.subscribe(loader.load);
    return () => {
        loader.cancel();
        unsubscribe();
    };
}

export interface BrowserSources {
    changes: ExternalStore<unknown>;
    moves: PathMoves;
}

export function useBrowser(
    startDirectory: string,
    { changes, moves }: BrowserSources
): [BrowserState, Dispatch<BrowserAction>] {
    const [state, dispatch] = useReducer(
        reduceBrowserState,
        startDirectory,
        createBrowserState
    );

    useEffect(
        () => watchListing(state.directory, changes, dispatch),
        [state.directory, changes]
    );

    useEffect(
        () => moves.subscribe((move) => dispatch({ type: "moved", move })),
        [moves]
    );

    return [state, dispatch];
}
