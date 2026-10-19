import { useInput } from "ink";
import type { Dispatch } from "react";
import type { BrowserAction } from "../browser-state.js";
import { getKeyAction, type KeyAction } from "../key-actions.js";
import type { TaggingQueue } from "../tagging-queue.js";
import type { BrowserEntry, TagTarget } from "../types.js";

export interface KeyboardControls {
    dispatch: Dispatch<BrowserAction>;
    hovered: BrowserEntry | undefined;
    directory: string;
    queue: TaggingQueue;
    quitting: boolean;
    requestQuit(): void;
    pageSize: number;
}

function getTagTarget(entry: BrowserEntry | undefined): TagTarget | null {
    if (!entry || entry.kind === "parent") {
        return null;
    }

    return { kind: entry.kind, path: entry.path };
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

function createKeyHandlers(
    controls: KeyboardControls
): Record<KeyAction, () => void> {
    const { dispatch, pageSize } = controls;
    const move = (delta: number) => () => dispatch({ type: "move", delta });
    return {
        moveUp: move(-1),
        moveDown: move(1),
        pageUp: move(-pageSize),
        pageDown: move(pageSize),
        open: () => dispatch({ type: "open" }),
        parent: () => dispatch({ type: "parent" }),
        tag: () => enqueue(getTagTarget(controls.hovered), controls),
        tagFolder: () =>
            enqueue({ kind: "folder", path: controls.directory }, controls),
        stop: () => controls.queue.stop(),
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
