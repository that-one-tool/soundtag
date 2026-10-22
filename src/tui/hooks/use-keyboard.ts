import { useInput } from "ink";
import type { Dispatch } from "react";
import type { BrowserAction } from "../browser-state.js";
import { getKeyAction, type KeyAction } from "../key-actions.js";
import type { KeyPress } from "../name-field.js";
import type { TagClearer } from "../tag-clearer.js";
import type { ToggleSetting } from "../toggle-setting.js";
import type { TaggingQueue } from "../tagging-queue.js";
import type {
    BrowserEntry,
    EntryKind,
    FocusedPane,
    TagJobSettings,
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
    subfolders: ToggleSetting;
    renaming: ToggleSetting;
    fixing: ToggleSetting;
    overwriting: ToggleSetting;
    logView: LogView;
    logPageSize: number;
    rename: RenameControls;
    tagClearer: TagClearer;
}

type NavigationAction =
    "moveUp" | "moveDown" | "pageUp" | "pageDown" | "open" | "parent";

type KeyHandlers<Action extends KeyAction> = Record<Action, () => void>;

function getJobSettings(controls: KeyboardControls): TagJobSettings {
    return {
        renameFiles: controls.renaming.getSnapshot(),
        fixTags: controls.fixing.getSnapshot(),
        overwriteTags: controls.overwriting.getSnapshot(),
    };
}

function getFolderTarget(
    folder: string,
    controls: KeyboardControls
): TagTarget {
    const recursive = controls.subfolders.getSnapshot();
    const settings = getJobSettings(controls);
    return { kind: "folder", path: folder, recursive, settings };
}

const TARGET_BUILDERS: Record<
    EntryKind,
    (entry: BrowserEntry, controls: KeyboardControls) => TagTarget | null
> = {
    parent: () => null,
    file: ({ path }, controls) => ({
        kind: "file",
        path,
        settings: getJobSettings(controls),
    }),
    folder: ({ path }, controls) => getFolderTarget(path, controls),
};

function getTagTarget(
    entry: BrowserEntry | undefined,
    controls: KeyboardControls
): TagTarget | null {
    return entry ? TARGET_BUILDERS[entry.kind](entry, controls) : null;
}

// Nothing new may start once the user asked to quit, nor while a rename may
// still pull files away from a job, nor while a clear rewrites a file.
function canStartWork(controls: KeyboardControls): boolean {
    const { quitting, rename, tagClearer } = controls;
    return !quitting && !rename.isSaving() && !tagClearer.isClearing();
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

function requestClear(controls: KeyboardControls): void {
    if (canStartWork(controls)) {
        controls.tagClearer.request(controls.hovered);
    }
}

function confirmClear(controls: KeyboardControls): void {
    if (canStartWork(controls)) {
        void controls.tagClearer.confirm(controls.hovered);
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
        toggleRenaming: () => controls.renaming.toggle(),
        toggleFixing: () => controls.fixing.toggle(),
        toggleOverwriting: () => controls.overwriting.toggle(),
        rename: () => startRename(controls),
        clearTags: () => requestClear(controls),
        confirmClear: () => confirmClear(controls),
        toggleFocus: () => controls.logView.toggleFocus(),
        quit: () => controls.requestQuit(),
    };
}

// Any other key cancels a pending clear.
const CLEAR_ACTIONS: ReadonlySet<KeyAction | undefined> = new Set([
    "clearTags",
    "confirmClear",
]);

// n also answers no to a pending clear, so it must not switch renaming then.
function getBrowserAction(
    controls: KeyboardControls,
    { input, key }: KeyPress
): KeyAction | undefined {
    const action = getKeyAction(input, key);
    const answersClear =
        action === "toggleRenaming" && controls.tagClearer.isArmed();
    return answersClear ? undefined : action;
}

function handleBrowserKey(controls: KeyboardControls, keyPress: KeyPress) {
    const action = getBrowserAction(controls, keyPress);
    if (!CLEAR_ACTIONS.has(action)) {
        controls.tagClearer.disarm();
    }

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
