import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import NodeID3 from "node-id3";
import { test } from "node:test";
import { useTemporaryDirectories } from "./helpers/temporary-directories.js";

const projectRoot = process.cwd();
const tsxLoader = path.join(projectRoot, "node_modules/tsx/dist/loader.mjs");

const createTemporaryDirectory = useTemporaryDirectories("soundtag-cli-test-");

const INTERRUPT = Symbol("interrupt");

interface CliRunOptions {
    environment?: NodeJS.ProcessEnv;
    answers?: (string | typeof INTERRUPT)[];
}

function runCli(
    workingDirectory: string,
    args: string[],
    {
        environment = {
            MUSICBRAINZ_USER_AGENT: "SoundTag/1.0 (test@example.com)",
        },
        answers = [],
    }: CliRunOptions = {}
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                "--import",
                tsxLoader,
                path.join(projectRoot, "src/index.ts"),
                ...args,
            ],
            {
                cwd: workingDirectory,
                env: {
                    ...process.env,
                    LASTFM_API_KEY: "test-key",
                    MUSICBRAINZ_USER_AGENT: undefined,
                    YOUTUBE_API_KEY: undefined,
                    ...environment,
                },
                stdio: ["pipe", "pipe", "pipe"],
            }
        );
        const pendingAnswers = [...answers];
        let stdout = "";
        let stderr = "";

        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            stdout += chunk;

            if (stdout.endsWith(": ") && pendingAnswers.length > 0) {
                const answer = pendingAnswers.shift();

                if (answer === INTERRUPT) {
                    child.kill("SIGINT");
                    return;
                }

                child.stdin.write(`${answer}\n`);
            }

            if (pendingAnswers.length === 0) {
                child.stdin.end();
            }
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.once("error", reject);
        child.once("spawn", () => {
            if (pendingAnswers.length === 0) {
                child.stdin.end();
            }
        });
        child.once("close", (exitCode) =>
            resolve({ exitCode, stdout, stderr })
        );
    });
}

test("CLI writes a report and --no-recursive excludes nested audio files", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const sourceDirectory = path.join(workingDirectory, "source");
    await fs.mkdir(path.join(sourceDirectory, "nested"), { recursive: true });
    await fs.writeFile(
        path.join(sourceDirectory, "nested", "nested.mp3"),
        "audio"
    );

    const { exitCode, stdout, stderr } = await runCli(workingDirectory, [
        sourceDirectory,
        "--no-recursive",
    ]);

    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /No supported audio files found/);
    const report = JSON.parse(
        await fs.readFile(
            path.join(sourceDirectory, "soundtag_output.json"),
            "utf8"
        )
    ) as { files: Record<string, string> };
    await assert.rejects(
        fs.access(path.join(workingDirectory, "soundtag_output.json"))
    );
    assert.deepEqual(report, { files: {} });
});

test("CLI records a properly tagged file as skipped in the report", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const sourceDirectory = path.join(workingDirectory, "source");
    const source = path.join(sourceDirectory, "already-tagged.mp3");
    await fs.mkdir(sourceDirectory);
    await fs.writeFile(source, "audio bytes");
    assert.equal(
        NodeID3.write(
            {
                title: "Title",
                artist: "Artist",
                album: "Album",
                year: "2024",
                image: {
                    mime: "image/jpeg",
                    type: { id: 3, name: "front cover" },
                    description: "Cover",
                    imageBuffer: Buffer.from("cover image"),
                },
            },
            source
        ),
        true
    );

    const { exitCode, stderr } = await runCli(workingDirectory, [
        sourceDirectory,
        "--no-recursive",
    ]);

    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    const report = JSON.parse(
        await fs.readFile(
            path.join(sourceDirectory, "soundtag_output.json"),
            "utf8"
        )
    ) as { files: Record<string, string> };
    assert.deepEqual(report, { files: { "already-tagged.mp3": "SKIPPED" } });
});

test("CLI reports invalid options and still writes the report", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const { exitCode, stderr } = await runCli(workingDirectory, ["--unknown"]);

    assert.equal(exitCode, 1);
    assert.match(stderr, /Unknown option: --unknown/);
    const report = JSON.parse(
        await fs.readFile(
            path.join(workingDirectory, "soundtag_output.json"),
            "utf8"
        )
    ) as { files: Record<string, string> };
    assert.deepEqual(report, { files: {} });
});

test("CLI accepts the verbose option", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const sourceDirectory = path.join(workingDirectory, "source");
    await fs.mkdir(sourceDirectory);

    const { exitCode, stderr } = await runCli(workingDirectory, [
        sourceDirectory,
        "-v",
    ]);

    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
});

test("CLI warns at startup when MusicBrainz is not configured", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const sourceDirectory = path.join(workingDirectory, "source");
    await fs.mkdir(sourceDirectory);

    const { exitCode, stderr } = await runCli(
        workingDirectory,
        [sourceDirectory],
        { environment: {} }
    );

    assert.equal(exitCode, 0);
    assert.equal(
        stderr,
        "MusicBrainz fallback requires MUSICBRAINZ_USER_AGENT.\n"
    );
});

test("CLI prompts for the API key and browses folders when not provided", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const sourceDirectory = path.join(workingDirectory, "source");
    await fs.mkdir(sourceDirectory);

    const { exitCode, stdout, stderr } = await runCli(workingDirectory, [], {
        environment: {
            LASTFM_API_KEY: undefined,
            MUSICBRAINZ_USER_AGENT: "SoundTag/1.0 (test@example.com)",
        },
        answers: ["prompted-key", "1", "s", "q"],
    });

    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /Enter your Last\.fm API key: /);
    assert.match(stdout, /1\) source\n/);
    assert.match(stdout, /Choose a folder: /);
    assert.match(
        stdout,
        /No supported audio files found in the source folder\./
    );
});

test("CLI fails cleanly when input ends during a prompt", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const { exitCode, stderr } = await runCli(workingDirectory, [], {
        environment: { LASTFM_API_KEY: undefined },
    });

    assert.equal(exitCode, 1);
    assert.match(stderr, /^Error: Input ended before an answer was given\.$/m);
    assert.doesNotMatch(stderr, /unsettled top-level await/);
    const report = JSON.parse(
        await fs.readFile(
            path.join(workingDirectory, "soundtag_output.json"),
            "utf8"
        )
    ) as { files: Record<string, string> };
    assert.deepEqual(report, { files: {} });
});

test("CLI stops with exit code 130 when interrupted at a prompt", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const { exitCode, stdout, stderr } = await runCli(workingDirectory, [], {
        environment: { LASTFM_API_KEY: undefined },
        answers: [INTERRUPT],
    });

    assert.equal(exitCode, 130);
    assert.equal(stderr, "");
    assert.match(stdout, /Interrupted\./);
    assert.doesNotMatch(stdout, /Press Ctrl\+C again/);
    assert.match(stdout, /Processing report written to /);
});

test("CLI stops with exit code 130 when interrupted at the folder browser", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const { exitCode, stderr } = await runCli(workingDirectory, [], {
        answers: [INTERRUPT],
    });

    assert.equal(exitCode, 130);
    assert.equal(stderr, "");
    await assert.rejects(
        fs.access(path.join(workingDirectory, "soundtag_output.json"))
    );
});

test("CLI quits the folder browser when input ends", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const { exitCode, stdout, stderr } = await runCli(workingDirectory, []);

    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /Choose a folder: /);
    await assert.rejects(
        fs.access(path.join(workingDirectory, "soundtag_output.json"))
    );
});
