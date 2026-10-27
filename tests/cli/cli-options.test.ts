import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArguments } from "../../src/cli/cli-options.js";

test("parseArguments keeps the recursive default and reads a source path", () => {
    assert.deepEqual(parseArguments(["./music"]), {
        sourcePaths: ["./music"],
        recursive: true,
        verbose: false,
        overwrite: false,
        json: false,
    });
});

test("parseArguments supports scan and verbose options", () => {
    assert.deepEqual(parseArguments(["./music", "--no-recursive", "-v"]), {
        sourcePaths: ["./music"],
        recursive: false,
        verbose: true,
        overwrite: false,
        json: false,
    });
    assert.equal(
        parseArguments(["--no-recursive", "--recursive"]).recursive,
        true
    );
});

test("parseArguments rejects unknown flags", () => {
    assert.throws(() => parseArguments(["--unknown"]), /Unknown option/);
});

test("parseArguments reads several source paths in order", () => {
    assert.deepEqual(
        parseArguments(["a.mp3", "-v", "music", "b.flac"]).sourcePaths,
        ["a.mp3", "music", "b.flac"]
    );
});

test("parseArguments treats names of object properties as source paths", () => {
    assert.deepEqual(parseArguments(["constructor"]).sourcePaths, [
        "constructor",
    ]);
    assert.deepEqual(parseArguments(["toString"]).sourcePaths, ["toString"]);
});

test("parseArguments accepts the long and short option aliases", () => {
    assert.deepEqual(parseArguments(["--no-recursive", "-r", "--verbose"]), {
        sourcePaths: [],
        recursive: true,
        verbose: true,
        overwrite: false,
        json: false,
    });
});

test("parseArguments rejects the removed renaming, fix and cover options", () => {
    for (const option of [
        "--rename",
        "--no-rename",
        "--fix",
        "--replace-covers",
        "--covers-only",
    ]) {
        assert.throws(() => parseArguments([option]), /Unknown option/);
    }
});

test("parseArguments turns overwriting on with --overwrite", () => {
    assert.equal(parseArguments(["./music", "--overwrite"]).overwrite, true);
});

test("parseArguments turns JSON events on with --json", () => {
    assert.equal(parseArguments(["./music", "--json"]).json, true);
});
