import assert from "node:assert/strict";
import { test } from "node:test";
import { wrapLogLines } from "../../src/tui/log-wrap.js";

function createLine(id: number, text: string) {
    return { id, text, isError: id === 2 };
}

test("wrapLogLines keeps lines that fit", () => {
    const lines = [createLine(0, "short"), createLine(1, "")];

    assert.deepEqual(wrapLogLines(lines, 20), lines);
});

test("wrapLogLines continues long lines at a space, indented under the step text", () => {
    const line = createLine(
        2,
        "  search Deezer ✓ genre 0.2s · iTunes no match"
    );

    assert.deepEqual(wrapLogLines([line], 30), [
        { id: 2, text: "  search Deezer ✓ genre 0.2s ·", isError: true },
        { id: 2.001, text: "         iTunes no match", isError: true },
    ]);
});

test("wrapLogLines cuts a long word that has no space to break at", () => {
    const rows = wrapLogLines([createLine(0, "x".repeat(45))], 20);

    assert.deepEqual(
        rows.map(({ text }) => text.length),
        [20, 20, 20, 12]
    );
});

test("wrapLogLines leaves lines alone in a pane too narrow to indent", () => {
    const line = createLine(0, "a long line that cannot be indented");

    assert.deepEqual(wrapLogLines([line], 12), [line]);
});
