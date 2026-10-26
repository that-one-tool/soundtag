import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArguments } from "../../src/cli/cli-options.js";

test("parseArguments keeps the recursive default and reads a source path", () => {
    assert.deepEqual(parseArguments(["./music"]), {
        sourcePath: "./music",
        recursive: true,
        verbose: false,
        renameFiles: false,
        fixTags: false,
    });
});

test("parseArguments supports scan and verbose options", () => {
    assert.deepEqual(
        parseArguments(["./music", "--no-recursive", "-v", "--no-rename"]),
        {
            sourcePath: "./music",
            recursive: false,
            verbose: true,
            renameFiles: false,
            fixTags: false,
        }
    );
    assert.equal(
        parseArguments(["--no-recursive", "--recursive"]).recursive,
        true
    );
});

test("parseArguments rejects unknown flags and multiple source paths", () => {
    assert.throws(() => parseArguments(["--unknown"]), /Unknown option/);
    assert.throws(
        () => parseArguments(["./music", "./other"]),
        /Only one source folder path/
    );
});

test("parseArguments treats names of object properties as source paths", () => {
    assert.equal(parseArguments(["constructor"]).sourcePath, "constructor");
    assert.equal(parseArguments(["toString"]).sourcePath, "toString");
});

test("parseArguments accepts the long and short option aliases", () => {
    assert.deepEqual(parseArguments(["--no-recursive", "-r", "--verbose"]), {
        recursive: true,
        verbose: true,
        renameFiles: false,
        fixTags: false,
    });
});

test("parseArguments turns renaming on with --rename, and off again with --no-rename", () => {
    assert.equal(parseArguments(["--rename"]).renameFiles, true);
    assert.equal(
        parseArguments(["--rename", "--no-rename"]).renameFiles,
        false
    );
});

test("parseArguments turns fix mode on with --fix", () => {
    assert.equal(parseArguments(["./music", "--fix"]).fixTags, true);
});
