import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import NodeID3 from "node-id3";
import { test } from "node:test";
import { runApp } from "../../src/cli/app.js";
import { InputCancelledError } from "../../src/shared/errors.js";
import { captureConsole } from "../helpers/console.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const output = captureConsole();
const createTemporaryDirectory = useTemporaryDirectories("soundtag-app-test-");
const environment = {
    LASTFM_API_KEY: "test-key",
    MUSICBRAINZ_USER_AGENT: "SoundTag/1.0 (test@example.com)",
};

async function readReport(directory: string): Promise<unknown> {
    return JSON.parse(
        await fs.readFile(path.join(directory, "soundtag_output.json"), "utf8")
    );
}

function runAppIn(
    workingDirectory: string,
    argv: string[],
    stopSignal = new AbortController().signal
): Promise<number> {
    return runApp({
        argv,
        env: environment,
        ask: async () => "",
        workingDirectory,
        stopSignal,
    });
}

test("runApp tags a library and prints a summary", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const source = path.join(workingDirectory, "tagged.mp3");
    await fs.writeFile(source, "audio bytes");
    NodeID3.write(
        {
            title: "Title",
            artist: "Artist",
            year: "2024",
            image: {
                mime: "image/jpeg",
                type: { id: 3, name: "front cover" },
                description: "Cover",
                imageBuffer: Buffer.from("cover"),
            },
        },
        source
    );

    assert.equal(await runAppIn(workingDirectory, ["."]), 0);
    assert.deepEqual(await readReport(workingDirectory), {
        files: { "tagged.mp3": "SKIPPED" },
    });
    assert.equal(output.logs[1], "                SOUNDTAG");
    assert.ok(output.logs.includes("Skipped:    1"));
    assert.ok(output.logs.includes("PROCESSING COMPLETE"));
});

test("runApp reports an empty library without a summary", async () => {
    const workingDirectory = await createTemporaryDirectory();

    assert.equal(await runAppIn(workingDirectory, ["."]), 0);
    assert.deepEqual(await readReport(workingDirectory), { files: {} });
    assert.ok(
        output.logs.includes(
            "No supported audio files found in the source folder."
        )
    );
    assert.ok(!output.logs.includes("PROCESSING COMPLETE"));
});

test("runApp fails on configuration errors and still writes the report", async () => {
    const workingDirectory = await createTemporaryDirectory();

    assert.equal(await runAppIn(workingDirectory, ["--unknown"]), 1);
    assert.deepEqual(output.errors, ["Error: Unknown option: --unknown"]);
    assert.deepEqual(await readReport(workingDirectory), { files: {} });
});

test("runApp fails when the report cannot be written", async () => {
    const workingDirectory = await createTemporaryDirectory();
    await fs.mkdir(path.join(workingDirectory, "soundtag_output.json"));

    assert.equal(await runAppIn(workingDirectory, ["."]), 1);
    assert.match(
        output.errors.at(-1) ?? "",
        /^Could not write processing report to /
    );
});

test("runApp writes the report into the source folder", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const sourceDirectory = path.join(workingDirectory, "music");
    await fs.mkdir(sourceDirectory);

    assert.equal(await runAppIn(workingDirectory, ["music"]), 0);
    assert.deepEqual(await readReport(sourceDirectory), { files: {} });
    await assert.rejects(
        fs.access(path.join(workingDirectory, "soundtag_output.json"))
    );
});

test("runApp exits with 130 and keeps unprocessed files as read when stopped", async () => {
    const workingDirectory = await createTemporaryDirectory();
    await fs.writeFile(path.join(workingDirectory, "song.mp3"), "audio bytes");

    assert.equal(
        await runAppIn(workingDirectory, ["."], AbortSignal.abort()),
        130
    );
    assert.deepEqual(await readReport(workingDirectory), {
        files: { "song.mp3": "READ" },
    });
    assert.ok(output.logs.includes("PROCESSING STOPPED"));
    assert.ok(!output.logs.includes("PROCESSING COMPLETE"));
});

test("runApp exits with 130 without an error when stopped at a prompt", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const stop = new AbortController();

    const exitCode = await runApp({
        argv: [],
        env: {},
        ask: async () => {
            stop.abort();
            throw new InputCancelledError();
        },
        workingDirectory,
        stopSignal: stop.signal,
    });

    assert.equal(exitCode, 130);
    assert.deepEqual(output.errors, []);
    assert.deepEqual(await readReport(workingDirectory), { files: {} });
});

test("runApp still reports real errors after a stop was requested", async () => {
    const workingDirectory = await createTemporaryDirectory();

    assert.equal(
        await runAppIn(workingDirectory, ["missing"], AbortSignal.abort()),
        1
    );
    assert.deepEqual(output.errors, [
        "Error: The source folder does not exist.",
    ]);
});
