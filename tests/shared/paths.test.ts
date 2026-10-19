import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { isInsideFolder, movePath } from "../../src/shared/paths.js";

const root = path.resolve("library");
const album = path.join(root, "Album");
const move = { source: album, destination: path.join(root, "A - B") };

test("isInsideFolder accepts the folder itself and its descendants", () => {
    assert.equal(isInsideFolder(album, album), true);
    assert.equal(isInsideFolder(path.join(album, "CD1", "a.mp3"), album), true);
});

test("isInsideFolder rejects siblings, parents and look-alike names", () => {
    assert.equal(isInsideFolder(root, album), false);
    assert.equal(isInsideFolder(path.join(root, "Album 2"), album), false);
    assert.equal(isInsideFolder(path.join(root, "..Album"), album), false);
});

test("movePath moves the folder itself and what it contains", () => {
    assert.equal(movePath(album, move), move.destination);
    assert.equal(
        movePath(path.join(album, "a.mp3"), move),
        path.join(move.destination, "a.mp3")
    );
});

test("movePath keeps paths outside the moved folder", () => {
    const sibling = path.join(root, "Album 2", "a.mp3");

    assert.equal(movePath(sibling, move), sibling);
});
