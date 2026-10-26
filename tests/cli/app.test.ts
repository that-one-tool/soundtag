import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import NodeID3 from "node-id3";
import { test } from "node:test";
import { runApp, type AppEnvironment } from "../../src/cli/app.js";
import type { TuiOptions } from "../../src/tui/run-tui.js";
import type { TuiOutcome } from "../../src/tui/types.js";
import { captureConsole } from "../helpers/console.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import { assertNoReport } from "../helpers/no-report.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

restoreFetchAfterEach();
const output = captureConsole();
const createTemporaryDirectory = useTemporaryDirectories("soundtag-app-test-");
const withoutBrowser = {
    canBrowse: false,
    openBrowser: async (): Promise<TuiOutcome> =>
        assert.fail("The browser should not open."),
};
const environment = {
    LASTFM_API_KEY: "test-key",
    LISTENBRAINZ_TOKEN: "test-token",
    MUSICBRAINZ_USER_AGENT: "SoundTag/1.0 (test@example.com)",
};

async function writeFullyTaggedMp3(source: string): Promise<void> {
    await fs.mkdir(path.dirname(source), { recursive: true });
    await fs.writeFile(source, "audio bytes");
    NodeID3.write(
        {
            title: "Title",
            artist: "Artist",
            year: "2024",
            genre: "Rock",
            image: {
                mime: "image/jpeg",
                type: { id: 3, name: "front cover" },
                description: "Cover",
                imageBuffer: Buffer.from("cover"),
            },
        },
        source
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
        workingDirectory,
        renewStopSignal: () => stopSignal,
        ...withoutBrowser,
    });
}

test("runApp tags a library and prints a summary", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const source = path.join(workingDirectory, "tagged.mp3");
    await writeFullyTaggedMp3(source);

    assert.equal(await runAppIn(workingDirectory, ["."]), 0);
    assert.equal(output.logs[1], "                SOUNDTAG");
    assert.ok(
        output.logs.includes(
            "Usage: soundtag [source-folder] [--recursive | --no-recursive] [-v | --verbose] [--overwrite]"
        )
    );
    assert.ok(output.logs.includes("Existing tags: kept"));
    assert.ok(output.logs.includes("Skipped:    1"));
    assert.ok(output.logs.includes("PROCESSING COMPLETE"));
    assert.deepEqual(output.logs.slice(-2), [
        "========================================",
        "Done!",
    ]);
    await fs.access(source);
    assert.ok(!output.logs.includes("Failed:"));
    assert.ok(!output.logs.some((line) => line.startsWith("Not processed:")));
    await assertNoReport(workingDirectory);
});

test("runApp searches fully tagged files again with --overwrite", async () => {
    const workingDirectory = await createTemporaryDirectory();
    await writeFullyTaggedMp3(path.join(workingDirectory, "tagged.mp3"));
    globalThis.fetch = async () => new Response(null, { status: 500 });

    assert.equal(await runAppIn(workingDirectory, [".", "--overwrite"]), 0);

    assert.ok(output.logs.includes("Existing tags: overwritten"));
    assert.ok(output.logs.includes("  skip   not found"));
    assert.ok(!output.logs.includes("  skip   already tagged"));
});

test("runApp lists failed files relative to the source", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const disc = path.join(workingDirectory, "Disc 2");
    await writeFullyTaggedMp3(path.join(disc, "tagged.mp3"));
    await fs.writeFile(path.join(disc, "broken.flac"), "bytes");

    assert.equal(await runAppIn(workingDirectory, ["."]), 0);
    assert.ok(output.logs.includes("Errors:     1"));
    assert.deepEqual(output.logs.slice(-4), [
        "Failed:",
        `  ${path.join("Disc 2", "broken.flac")}`,
        "========================================",
        "Done!",
    ]);
});

test("runApp reports an empty library without a summary", async () => {
    const workingDirectory = await createTemporaryDirectory();

    assert.equal(await runAppIn(workingDirectory, ["."]), 0);
    assert.ok(
        output.logs.includes(
            "No supported audio files found in the source folder."
        )
    );
    assert.ok(!output.logs.includes("PROCESSING COMPLETE"));
});

test("runApp fails on configuration errors", async () => {
    const workingDirectory = await createTemporaryDirectory();

    assert.equal(await runAppIn(workingDirectory, ["--unknown"]), 1);
    assert.deepEqual(output.errors, ["Error: Unknown option: --unknown"]);
    assert.ok(!output.logs.includes("Done!"));
});

test("runApp exits with 130 when stopped", async () => {
    const workingDirectory = await createTemporaryDirectory();
    await fs.writeFile(path.join(workingDirectory, "song.mp3"), "audio bytes");

    assert.equal(
        await runAppIn(workingDirectory, ["."], AbortSignal.abort()),
        130
    );
    assert.ok(output.logs.includes("PROCESSING STOPPED"));
    assert.ok(output.logs.includes("Not processed: 1"));
    assert.ok(!output.logs.includes("PROCESSING COMPLETE"));
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
    assert.equal(output.logs.at(-1), "Done!");
});

function browseWith(
    workingDirectory: string,
    openBrowser: AppEnvironment["openBrowser"]
): Promise<number> {
    return runApp({
        argv: ["--no-recursive"],
        env: environment,
        workingDirectory,
        renewStopSignal: () => new AbortController().signal,
        canBrowse: true,
        openBrowser,
    });
}

test("runApp opens the folder browser in the working directory", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const opened: TuiOptions[] = [];

    const exitCode = await browseWith(workingDirectory, async (options) => {
        opened.push(options);
        return "success";
    });

    assert.equal(exitCode, 0);
    assert.deepEqual(opened, [
        {
            startDirectory: workingDirectory,
            lastFmApiKey: "test-key",
            recursive: false,
            verbose: false,
            overwrite: false,
            musicBrainzUserAgent: "SoundTag/1.0 (test@example.com)",
            youtubeApiKey: undefined,
            listenBrainzToken: "test-token",
            coverMode: undefined,
            discogsConsumerKey: undefined,
            discogsConsumerSecret: undefined,
        },
    ]);
    assert.deepEqual(output.errors, []);
});

test("runApp maps the browser outcome to an exit code", async () => {
    const workingDirectory = await createTemporaryDirectory();

    assert.equal(await browseWith(workingDirectory, async () => "failure"), 1);
    assert.equal(await browseWith(workingDirectory, async () => "forced"), 130);
    assert.equal(
        await browseWith(
            workingDirectory,
            async () => undefined as unknown as TuiOutcome
        ),
        1
    );
});

test("runApp needs an interactive terminal to browse folders", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const exitCode = await runApp({
        argv: [],
        env: {},
        workingDirectory,
        renewStopSignal: () => new AbortController().signal,
        ...withoutBrowser,
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output.errors, [
        "Error: Browsing folders needs an interactive terminal; pass a source folder instead.",
    ]);
});

test("runApp still fails on unexpected browser errors", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const exitCode = await browseWith(workingDirectory, async () => {
        throw new Error("terminal broke");
    });

    assert.equal(exitCode, 1);
    assert.deepEqual(output.errors, ["Error: terminal broke"]);
});
