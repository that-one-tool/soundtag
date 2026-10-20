import assert from "node:assert/strict";
import { test } from "node:test";
import type { Key } from "ink";
import {
    createNameField,
    editNameField,
    getFieldWindow,
    type NameField,
} from "../../src/tui/name-field.js";

function key(overrides: Partial<Key> = {}): Key {
    return { ...({} as Key), ...overrides };
}

function press(field: NameField, overrides: Partial<Key>): NameField {
    return editNameField(field, { input: "", key: key(overrides) });
}

function type(field: NameField, input: string): NameField {
    return editNameField(field, { input, key: key() });
}

test("createNameField puts the caret after the text", () => {
    assert.deepEqual(createNameField("Song"), { text: "Song", caret: 4 });
});

test("editNameField inserts typed and pasted text at the caret", () => {
    const field = { text: "Sng", caret: 1 };

    assert.deepEqual(type(field, "o"), { text: "Song", caret: 2 });
    assert.deepEqual(type(field, "ilent so"), {
        text: "Silent song",
        caret: 9,
    });
});

test("editNameField drops control characters and modified keys", () => {
    const field = createNameField("Song");

    assert.deepEqual(type(field, "\tA\u0007\n"), { text: "SongA", caret: 5 });
    assert.equal(
        editNameField(field, { input: "c", key: key({ ctrl: true }) }),
        field
    );
    assert.equal(
        editNameField(field, { input: "b", key: key({ meta: true }) }),
        field
    );
});

test("editNameField moves the caret within the text", () => {
    const field = { text: "Song", caret: 2 };

    assert.equal(press(field, { leftArrow: true }).caret, 1);
    assert.equal(press(field, { rightArrow: true }).caret, 3);
    assert.equal(press(field, { home: true }).caret, 0);
    assert.equal(press(field, { end: true }).caret, 4);
    assert.equal(
        press({ text: "Song", caret: 0 }, { leftArrow: true }).caret,
        0
    );
    assert.equal(
        press({ text: "Song", caret: 4 }, { rightArrow: true }).caret,
        4
    );
});

test("editNameField deletes around the caret", () => {
    const field = { text: "Song", caret: 2 };

    assert.deepEqual(press(field, { backspace: true }), {
        text: "Sng",
        caret: 1,
    });
    assert.deepEqual(press(field, { delete: true }), { text: "Sog", caret: 2 });
    assert.deepEqual(press({ text: "Song", caret: 0 }, { backspace: true }), {
        text: "Song",
        caret: 0,
    });
    assert.deepEqual(press({ text: "Song", caret: 4 }, { delete: true }), {
        text: "Song",
        caret: 4,
    });
});

test("editNameField steps over whole graphemes", () => {
    const emoji = createNameField("A🎵");
    const accented = { text: "Cafés", caret: 6 };

    assert.deepEqual(press(emoji, { backspace: true }), {
        text: "A",
        caret: 1,
    });
    assert.equal(press(emoji, { leftArrow: true }).caret, 1);
    assert.equal(press(accented, { leftArrow: true }).caret, 5);
    assert.equal(
        press({ ...accented, caret: 5 }, { leftArrow: true }).caret,
        3
    );
    assert.equal(
        press({ ...accented, caret: 3 }, { rightArrow: true }).caret,
        5
    );
    assert.deepEqual(press({ ...accented, caret: 3 }, { delete: true }), {
        text: "Cafs",
        caret: 3,
    });
});

test("getFieldWindow shows the whole text when it fits", () => {
    assert.deepEqual(getFieldWindow({ text: "Song", caret: 1 }, 10), {
        beforeCaret: "S",
        atCaret: "o",
        afterCaret: "ng",
    });
    assert.deepEqual(getFieldWindow(createNameField("Song"), 10), {
        beforeCaret: "Song",
        atCaret: " ",
        afterCaret: "",
    });
});

test("getFieldWindow counts wide characters as two cells", () => {
    assert.deepEqual(getFieldWindow(createNameField("日本語"), 5), {
        beforeCaret: "本語",
        atCaret: " ",
        afterCaret: "",
    });
    assert.deepEqual(getFieldWindow({ text: "日本語", caret: 0 }, 5), {
        beforeCaret: "",
        atCaret: "日",
        afterCaret: "本",
    });
});

test("getFieldWindow scrolls a long text to keep the caret visible", () => {
    const field = createNameField("0123456789");

    assert.deepEqual(getFieldWindow(field, 4), {
        beforeCaret: "789",
        atCaret: " ",
        afterCaret: "",
    });
    assert.deepEqual(getFieldWindow({ ...field, caret: 0 }, 4), {
        beforeCaret: "",
        atCaret: "0",
        afterCaret: "123",
    });
    assert.deepEqual(getFieldWindow({ text: "A🎵B", caret: 1 }, 1), {
        beforeCaret: "",
        atCaret: "🎵",
        afterCaret: "",
    });
});
