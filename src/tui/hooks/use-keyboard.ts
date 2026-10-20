import { useInput } from "ink";
import type { Dispatch } from "react";
import type { BrowserAction } from "../browser-state.js";
import { getKeyAction, type KeyAction } from "../key-actions.js";
import type { KeyPress } from "../name-field.js";
import type { SubfolderSetting } from "../subfolder-setting.js";
import type { TaggingQueue } from "../tagging-queue.js";
import type {
    BrowserEntry,
    EntryKind,
    FocusedPane,
    TagTarget,
} from "../types.js";
import type { LogView } from "./use-log-view.js";
import type { RenameControls } from "./use-rename.js";

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
    rename: RenameControls;
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

// Nothing new may start once the user asked to quit, nor while a rename may
// still pull files away from a job.
function canStartWork({ quitting, rename }: KeyboardControls): boolean {
    return !quitting && !rename.isSaving();
}

function enqueue(target: TagTarget | null, controls: KeyboardControls): void {
    if (target && canStartWork(controls)) {
        controls.queue.enqueue(target);
    }
}

function startRename(controls: KeyboardControls): void {
    if (canStartWork(controls)) {
        controls.rename.startRename(controls.hovered);
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
        rename: () => startRename(controls),
        toggleFocus: () => controls.logView.toggleFocus(),
        quit: () => controls.requestQuit(),
    };
}

function handleBrowserKey(
    controls: KeyboardControls,
    { input, key }: KeyPress
) {
    const action = getKeyAction(input, key);

    if (action) {
        createKeyHandlers(controls)[action]();
    }
}

// One handler routes every key, so a key read right after e already goes to
// the name field.
export function useKeyboard(controls: KeyboardControls): void {
    useInput((input, key) => {
        if (controls.rename.isEditing()) {
            controls.rename.editDraft({ input, key });
            return;
        }

        handleBrowserKey(controls, { input, key });
    });
}
