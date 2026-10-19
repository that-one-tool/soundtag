import assert from "node:assert/strict";
import { test } from "node:test";
import {
    createBrowserState,
    reduceBrowserState,
    type BrowserState,
} from "../../src/tui/browser-state.js";
import type { BrowserEntry } from "../../src/tui/types.js";

const parent: BrowserEntry = { name: "..", path: "/", kind: "parent" };
const album: BrowserEntry = {
    name: "Album",
    path: "/music/Album",
    kind: "folder",
};
const song: BrowserEntry = {
    name: "a.mp3",
    path: "/music/a.mp3",
    kind: "file",
};
const other: BrowserEntry = {
    name: "b.mp3",
    path: "/music/b.mp3",
    kind: "file",
};

function loadedState(cursor = 0): BrowserState {
    const state = reduceBrowserState(createBrowserState("/music"), {
        type: "loaded",
        directory: "/music",
        listing: { entries: [parent, album, song, other] },
    });
    return { ...state, cursor };
}

test("createBrowserState starts empty in the given directory", () => {
    assert.deepEqual(createBrowserState("/music"), {
        directory: "/music",
        entries: [],
        cursor: 0,
    });
});

test("move keeps the cursor inside the list", () => {
    const state = loadedState(1);

    assert.equal(
        reduceBrowserState(state, { type: "move", delta: 1 }).cursor,
        2
    );
    assert.equal(
        reduceBrowserState(state, { type: "move", delta: -5 }).cursor,
        0
    );
    assert.equal(
        reduceBrowserState(state, { type: "move", delta: 50 }).cursor,
        3
    );
});

test("move does nothing on an empty list", () => {
    const state = createBrowserState("/music");

    assert.equal(
        reduceBrowserState(state, { type: "move", delta: 1 }).cursor,
        0
    );
});

test("open enters the hovered folder", () => {
    const state = reduceBrowserState(loadedState(1), { type: "open" });

    assert.equal(state.directory, "/music/Album");
});

test("open on the parent entry goes up and refocuses the folder left", () => {
    const state = reduceBrowserState(loadedState(0), { type: "open" });
    const reloaded = reduceBrowserState(state, {
        type: "loaded",
        directory: "/",
        listing: {
            entries: [{ name: "music", path: "/music", kind: "folder" }],
        },
    });

    assert.equal(state.directory, "/");
    assert.equal(reloaded.cursor, 0);
    assert.equal(reloaded.entries[0].path, "/music");
});

test("open on a file changes nothing", () => {
    const state = loadedState(2);

    assert.equal(reduceBrowserState(state, { type: "open" }), state);
});

test("parent goes up and focuses the folder that was left", () => {
    const state = reduceBrowserState(loadedState(2), { type: "parent" });
    const reloaded = reduceBrowserState(state, {
        type: "loaded",
        directory: "/",
        listing: {
            entries: [
                { name: "jazz", path: "/jazz", kind: "folder" },
                { name: "music", path: "/music", kind: "folder" },
            ],
        },
    });

    assert.equal(reloaded.directory, "/");
    assert.equal(reloaded.cursor, 1);
});

test("parent does nothing at the filesystem root", () => {
    const state = createBrowserState("/");

    assert.equal(reduceBrowserState(state, { type: "parent" }), state);
});

test("loaded keeps the hovered entry selected when it still exists", () => {
    const state = reduceBrowserState(loadedState(3), {
        type: "loaded",
        directory: "/music",
        listing: { entries: [parent, other] },
    });

    assert.equal(state.cursor, 1);
});

test("loaded clamps the cursor when the hovered entry disappeared", () => {
    const state = reduceBrowserState(loadedState(3), {
        type: "loaded",
        directory: "/music",
        listing: { entries: [parent, album], error: "boom" },
    });

    assert.equal(state.cursor, 1);
    assert.equal(state.error, "boom");
});

test("loaded ignores a listing of a folder that was left", () => {
    const state = reduceBrowserState(loadedState(1), { type: "open" });

    const stale = reduceBrowserState(state, {
        type: "loaded",
        directory: "/music",
        listing: { entries: [parent, album, song] },
    });

    assert.equal(stale, state);
});

test("loaded keeps the same entry objects for unchanged entries", () => {
    const state = loadedState(2);

    const reloaded = reduceBrowserState(state, {
        type: "loaded",
        directory: "/music",
        listing: { entries: [{ ...parent }, { ...song }, { ...other }] },
    });

    assert.equal(reloaded.entries[1], state.entries[2]);
});

const renamedAlbum = { source: "/music/Album", destination: "/music/A - B" };

test("moved keeps the cursor on a renamed folder", () => {
    const state = reduceBrowserState(loadedState(1), {
        type: "moved",
        move: renamedAlbum,
    });

    assert.equal(state.directory, "/music");
    assert.equal(state.focusPath, "/music/A - B");
    assert.equal(state.entries[1].path, "/music/A - B");
    assert.equal(state.entries[2], song);
});

test("moved follows the browsed folder when it is renamed", () => {
    const inside = reduceBrowserState(loadedState(1), { type: "open" });

    const state = reduceBrowserState(inside, {
        type: "moved",
        move: renamedAlbum,
    });

    assert.equal(state.directory, "/music/A - B");
});

test("moved keeps the folder to refocus when it is renamed", () => {
    const inside = reduceBrowserState(createBrowserState("/music/Album/CD1"), {
        type: "parent",
    });

    const state = reduceBrowserState(inside, {
        type: "moved",
        move: renamedAlbum,
    });

    assert.equal(state.directory, "/music/A - B");
    assert.equal(state.focusPath, "/music/A - B/CD1");
});

test("moved keeps the cursor on entries outside the renamed folder", () => {
    const state = reduceBrowserState(loadedState(2), {
        type: "moved",
        move: renamedAlbum,
    });

    assert.equal(state.focusPath, undefined);
    assert.equal(state.cursor, 2);
});

test("moved follows the folder of a listing that is still loading", () => {
    const state = reduceBrowserState(createBrowserState("/music/Album"), {
        type: "moved",
        move: renamedAlbum,
    });

    assert.equal(state.directory, "/music/A - B");
    assert.equal(state.focusPath, undefined);
});
