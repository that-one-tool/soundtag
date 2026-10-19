import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { applyChoice, browseFolder } from "../../src/cli/folder-browser.js";
import type { Ask } from "../../src/cli/config.js";
import { captureConsole } from "../helpers/console.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const output = captureConsole();
const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-folder-browser-test-"
);
const view = {
    directory: path.join(path.sep, "music", "Rock"),
    subfolders: ["AC-DC", "Pink Floyd"],
    audioFileCount: 0,
};

function createScriptedAsk(answers: string[]): {
    ask: Ask;
    questions: string[];
} {
    const questions: string[] = [];
    return {
        questions,
        ask: async (question) => {
            questions.push(question);
            return answers.shift() ?? "q";
        },
    };
}

test("applyChoice opens the numbered subfolder", () => {
    assert.deepEqual(applyChoice(view, " 2 "), {
        kind: "navigate",
        directory: path.join(view.directory, "Pink Floyd"),
    });
});

test("applyChoice goes up to the parent folder with 0", () => {
    assert.deepEqual(applyChoice(view, "0"), {
        kind: "navigate",
        directory: path.join(path.sep, "music"),
    });
});

test("applyChoice selects or quits with s and q in any case", () => {
    assert.deepEqual(applyChoice(view, "S"), {
        kind: "select",
        directory: view.directory,
    });
    assert.deepEqual(applyChoice(view, "q"), { kind: "quit" });
});

test("applyChoice stays in the current folder on invalid input", () => {
    for (const choice of ["", "3", "-1", "1.5", "abc", "0x1", "1e0"]) {
        assert.deepEqual(applyChoice(view, choice), {
            kind: "navigate",
            directory: view.directory,
            notice: "Invalid choice.",
        });
    }
});

test("browseFolder tells the user when a choice is invalid", async () => {
    const root = await createTemporaryDirectory();
    const { ask } = createScriptedAsk(["x", "q"]);

    await browseFolder(ask, root);

    assert.ok(output.logs.includes("Invalid choice."));
});

test("browseFolder navigates into a subfolder and returns the selection", async () => {
    const root = await createTemporaryDirectory();
    await fs.mkdir(path.join(root, "Album"));
    await fs.writeFile(path.join(root, "Album", "song.mp3"), "audio");
    await fs.mkdir(path.join(root, "Album", "Disc 1"));
    const { ask, questions } = createScriptedAsk(["1", "s"]);

    const selection = await browseFolder(ask, root);

    assert.equal(selection, path.join(root, "Album"));
    assert.deepEqual(questions, ["Choose a folder: ", "Choose a folder: "]);
    assert.deepEqual(output.logs.slice(-5), [
        `\n${path.join(root, "Album")}  (1 audio files)`,
        "  0) ..",
        "  1) Disc 1",
        "  s) process this folder",
        "  q) quit",
    ]);
});

test("browseFolder returns undefined when the user quits", async () => {
    const root = await createTemporaryDirectory();
    const { ask } = createScriptedAsk(["q"]);

    assert.equal(await browseFolder(ask, root), undefined);
});

test("browseFolder reports an unreadable folder and shows it empty", async () => {
    const root = await createTemporaryDirectory();
    const missing = path.join(root, "missing");
    const { ask } = createScriptedAsk(["0", "s"]);

    assert.equal(await browseFolder(ask, missing), root);
    assert.match(output.errors[0] ?? "", /^Cannot read .*missing: /);
    assert.ok(output.logs.includes(`\n${missing}  (0 audio files)`));
});
