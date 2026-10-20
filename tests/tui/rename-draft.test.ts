import assert from "node:assert/strict";
import { test } from "node:test";
import { getDraftName, startRenameDraft } from "../../src/tui/rename-draft.js";
import type { BrowserEntry } from "../../src/tui/types.js";

const song: BrowserEntry = {
    name: "Artist - Song.mp3",
    path: "/music/Artist - Song.mp3",
    kind: "file",
};
const album: BrowserEntry = {
    name: "Artist - Album 1.5",
    path: "/music/Artist - Album 1.5",
    kind: "folder",
};

test("startRenameDraft edits the stem of a file and keeps its extension", () => {
    const draft = startRenameDraft(song);

    assert.deepEqual(draft, {
        entry: song,
        extension: ".mp3",
        field: { text: "Artist - Song", caret: 13 },
    });
});

test("startRenameDraft edits the whole name of a folder", () => {
    const draft = startRenameDraft(album);

    assert.equal(draft?.extension, "");
    assert.equal(draft?.field.text, "Artist - Album 1.5");
});

test("startRenameDraft refuses the parent entry and no entry", () => {
    const parent: BrowserEntry = { name: "..", path: "/", kind: "parent" };

    assert.equal(startRenameDraft(parent), null);
    assert.equal(startRenameDraft(undefined), null);
});

test("getDraftName joins the edited stem and the extension", () => {
    const draft = startRenameDraft(song)!;

    assert.equal(
        getDraftName({ ...draft, field: { text: "Other", caret: 5 } }),
        "Other.mp3"
    );
});
