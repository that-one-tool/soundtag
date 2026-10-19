import { useInput } from "ink";
import type { Dispatch } from "react";
import type { BrowserAction } from "../browser-state.js";
import { getKeyAction, type KeyAction } from "../key-actions.js";
import type { SubfolderSetting } from "../subfolder-setting.js";
import type { TaggingQueue } from "../tagging-queue.js";
import type {
    BrowserEntry,
    EntryKind,
    FocusedPane,
    TagTarget,
} from "../types.js";
import type { LogView } from "./use-log-view.js";

export interface KeyboardControls {
    dispatch: Dispatch<BrowserAction>;
    hovered: BrowserEntry | undefined;
    directory: string;
    queue: TaggingQueue;
    quitting: boolean;
    requestQuit(): void;
    pageSize: number;
    subfolders: SubfolderSetting;
    logView: LogView;
    logPageSize: number;
}

type NavigationAction =
    "moveUp" | "moveDown" | "pageUp" | "pageDown" | "open" | "parent";

type KeyHandlers<Action extends KeyAction> = Record<Action, () => void>;

function getFolderTarget(
    folder: string,
    controls: KeyboardControls
): TagTarget {
    const recursive = controls.subfolders.getSnapshot();
    return { kind: "folder", path: folder, recursive };
}

const TARGET_BUILDERS: Record<
    EntryKind,
    (entry: BrowserEntry, controls: KeyboardControls) => TagTarget | null
> = {
    parent: () => null,
    file: ({ path }) => ({ kind: "file", path }),
    folder: ({ path }, controls) => getFolderTarget(path, controls),
};

function getTagTarget(
    entry: BrowserEntry | undefined,
    controls: KeyboardControls
): TagTarget | null {
    return entry ? TARGET_BUILDERS[entry.kind](entry, controls) : null;
}

// Nothing new may start once the user asked to quit.
function enqueue(
    target: TagTarget | null,
    { queue, quitting }: KeyboardControls
): void {
    if (target && !quitting) {
        queue.enqueue(target);
    }
}

function createBrowserNavigation({
    dispatch,
    pageSize,
}: KeyboardControls): KeyHandlers<NavigationAction> {
    const move = (delta: number) => () => dispatch({ type: "move", delta });
    return {
        moveUp: move(-1),
        moveDown: move(1),
        pageUp: move(-pageSize),
        pageDown: move(pageSize),
        open: () => dispatch({ type: "open" }),
        parent: () => dispatch({ type: "parent" }),
    };
}

function createLogNavigation({
    logView,
    logPageSize,
}: KeyboardControls): KeyHandlers<NavigationAction> {
    const scroll = (delta: number) => () => logView.scrollLog(delta);
    return {
        moveUp: scroll(-1),
        moveDown: scroll(1),
        pageUp: scroll(-logPageSize),
        pageDown: scroll(logPageSize),
        open: () => {},
        parent: () => {},
    };
}

const NAVIGATION_BY_FOCUS: Record<
    FocusedPane,
    (controls: KeyboardControls) => KeyHandlers<NavigationAction>
> = {
    browser: createBrowserNavigation,
    log: createLogNavigation,
};

function createKeyHandlers(controls: KeyboardControls): KeyHandlers<KeyAction> {
    return {
        ...NAVIGATION_BY_FOCUS[controls.logView.getFocus()](controls),
        tag: () => enqueue(getTagTarget(controls.hovered, controls), controls),
        tagFolder: () =>
            enqueue(getFolderTarget(controls.directory, controls), controls),
        stop: () => controls.queue.stop(),
        toggleSubfolders: () => controls.subfolders.toggle(),
        toggleFocus: () => controls.logView.toggleFocus(),
        quit: () => controls.requestQuit(),
    };
}

export function useKeyboard(controls: KeyboardControls): void {
    useInput((input, key) => {
        const action = getKeyAction(input, key);

        if (action) {
            createKeyHandlers(controls)[action]();
        }
    });
}
