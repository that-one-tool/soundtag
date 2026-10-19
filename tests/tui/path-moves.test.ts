import assert from "node:assert/strict";
import { test } from "node:test";
import { PathMoves } from "../../src/tui/path-moves.js";
import type { PathMove } from "../../src/shared/paths.js";

test("PathMoves tells subscribers about each move until they unsubscribe", () => {
    const moves = new PathMoves();
    const received: PathMove[] = [];
    const first = { source: "/music/a", destination: "/music/b" };
    const unsubscribe = moves.subscribe((move) => received.push(move));

    moves.record(first);
    unsubscribe();
    moves.record({ source: "/music/b", destination: "/music/c" });

    assert.deepEqual(received, [first]);
});
