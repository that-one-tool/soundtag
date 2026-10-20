import type { Key } from "ink";
import stringWidth from "string-width";

export interface NameField {
    text: string;
    caret: number;
}

export interface KeyPress {
    input: string;
    key: Key;
}

export interface FieldWindow {
    beforeCaret: string;
    atCaret: string;
    afterCaret: string;
}

type FieldEdit = (field: NameField, press: KeyPress) => NameField;

const CONTROL_CHARACTERS = /\p{Cc}/gu;
const GRAPHEMES = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function createNameField(text: string): NameField {
    return { text, caret: text.length };
}

// Stepping by grapheme keeps emoji and decomposed accents whole.
function listGraphemes(text: string): string[] {
    return Array.from(GRAPHEMES.segment(text), ({ segment }) => segment);
}

function listBoundaries(text: string): number[] {
    const starts = Array.from(GRAPHEMES.segment(text), ({ index }) => index);
    return [...starts, text.length];
}

function getPreviousBoundary({ text, caret }: NameField): number {
    return listBoundaries(text).findLast((boundary) => boundary < caret) ?? 0;
}

function getNextBoundary({ text, caret }: NameField): number {
    const next = listBoundaries(text).find((boundary) => boundary > caret);
    return next ?? text.length;
}

function removeRange({ text }: NameField, start: number, end: number) {
    return { text: text.slice(0, start) + text.slice(end), caret: start };
}

function insertTyped(field: NameField, { input, key }: KeyPress): NameField {
    if (key.ctrl || key.meta) {
        return field;
    }

    const typed = input.replace(CONTROL_CHARACTERS, "");
    const { text, caret } = field;
    return {
        text: text.slice(0, caret) + typed + text.slice(caret),
        caret: caret + typed.length,
    };
}

const KEY_EDITS: [(key: Key) => boolean, FieldEdit][] = [
    [
        (key) => key.leftArrow,
        (field) => ({ ...field, caret: getPreviousBoundary(field) }),
    ],
    [
        (key) => key.rightArrow,
        (field) => ({ ...field, caret: getNextBoundary(field) }),
    ],
    [(key) => key.home, (field) => ({ ...field, caret: 0 })],
    [(key) => key.end, (field) => createNameField(field.text)],
    [
        (key) => key.backspace,
        (field) => removeRange(field, getPreviousBoundary(field), field.caret),
    ],
    [
        (key) => key.delete,
        (field) => removeRange(field, field.caret, getNextBoundary(field)),
    ],
];

export function editNameField(field: NameField, press: KeyPress): NameField {
    const edit = KEY_EDITS.find(([matches]) => matches(press.key))?.[1];
    return (edit ?? insertTyped)(field, press);
}

function takeFitting(graphemes: string[], width: number): string[] {
    let used = 0;
    const fitting: string[] = [];
    for (const grapheme of graphemes) {
        used += stringWidth(grapheme);
        if (used > width) {
            break;
        }
        fitting.push(grapheme);
    }
    return fitting;
}

// Fills the width backward from the caret cell, then forward with what follows.
export function getFieldWindow(field: NameField, width: number): FieldWindow {
    const before = listGraphemes(field.text.slice(0, field.caret));
    const [atCaret = " ", ...after] = listGraphemes(
        field.text.slice(field.caret)
    );
    const room = width - stringWidth(atCaret);
    const shown = takeFitting(before.toReversed(), room).toReversed();
    return {
        beforeCaret: shown.join(""),
        atCaret,
        afterCaret: takeFitting(after, room - stringWidth(shown.join(""))).join(
            ""
        ),
    };
}
