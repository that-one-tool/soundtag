import type { Key } from "ink";

export type KeyAction =
    | "moveUp"
    | "moveDown"
    | "pageUp"
    | "pageDown"
    | "open"
    | "parent"
    | "tag"
    | "tagFolder"
    | "stop"
    | "toggleSubfolders"
    | "toggleRenaming"
    | "toggleFixing"
    | "toggleOverwriting"
    | "rename"
    | "clearTags"
    | "confirmClear"
    | "toggleFocus"
    | "quit";

type KeyMatcher = (input: string, key: Key) => boolean;

const KEY_BINDINGS: [KeyMatcher, KeyAction][] = [
    [(_input, key) => key.upArrow, "moveUp"],
    [(_input, key) => key.downArrow, "moveDown"],
    [(_input, key) => key.pageUp, "pageUp"],
    [(_input, key) => key.pageDown, "pageDown"],
    [(_input, key) => key.return || key.rightArrow, "open"],
    [(_input, key) => key.leftArrow || key.backspace || key.delete, "parent"],
    [(input) => input === "t", "tag"],
    [(input) => input === "a", "tagFolder"],
    [(input) => input === "s", "stop"],
    [(input) => input === "r", "toggleSubfolders"],
    [(input) => input === "n", "toggleRenaming"],
    [(input) => input === "f", "toggleFixing"],
    [(input) => input === "o", "toggleOverwriting"],
    [(input) => input === "e", "rename"],
    [(input) => input === "D", "clearTags"],
    [(input) => input.toLowerCase() === "y", "confirmClear"],
    [(_input, key) => key.tab, "toggleFocus"],
    [(input) => input === "q", "quit"],
    [(input, key) => key.ctrl && input === "c", "quit"],
];

export function getKeyAction(input: string, key: Key): KeyAction | undefined {
    return KEY_BINDINGS.find(([matches]) => matches(input, key))?.[1];
}
