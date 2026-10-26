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

interface CliRunOptions {
    environment?: NodeJS.ProcessEnv;
}

function runCli(
    workingDirectory: string,
    args: string[],
    {
        environment = {
            MUSICBRAINZ_USER_AGENT: "SoundTag/1.0 (test@example.com)",
        },
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
                    LISTENBRAINZ_TOKEN: "test-token",
                    MUSICBRAINZ_USER_AGENT: undefined,
                    YOUTUBE_API_KEY: undefined,
                    DISCOGS_CONSUMER_KEY: undefined,
                    DISCOGS_CONSUMER_SECRET: undefined,
                    XDG_CONFIG_HOME: workingDirectory,
                    ...environment,
                },
                stdio: ["pipe", "pipe", "pipe"],
            }
        );
        let stdout = "";
        let stderr = "";

        child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
            stdout += chunk;
        });
        child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.once("error", reject);
        child.once("spawn", () => child.stdin.end());
        child.once("close", (exitCode) =>
            resolve({ exitCode, stdout, stderr })
        );
    });
}

test("CLI --no-recursive excludes nested audio files", async () => {
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
});

test("CLI skips and renames a properly tagged file", async () => {
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
                genre: "Rock",
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

    const { exitCode, stdout, stderr } = await runCli(workingDirectory, [
        sourceDirectory,
        "--no-recursive",
        "--rename",
    ]);

    assert.equal(exitCode, 0);
    assert.equal(stderr, "");
    assert.match(stdout, /Skipped: {4}1/);
    assert.match(stdout, /already-tagged\.mp3 → Artist - Title\.mp3/);
    await fs.access(path.join(sourceDirectory, "Artist - Title.mp3"));
});

test("CLI reports invalid options", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const { exitCode, stderr } = await runCli(workingDirectory, ["--unknown"]);

    assert.equal(exitCode, 1);
    assert.match(stderr, /Unknown option: --unknown/);
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
        "MusicBrainz and ListenBrainz require MUSICBRAINZ_USER_AGENT.\n"
    );
});

test("CLI needs a terminal to browse folders", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const { exitCode, stderr } = await runCli(workingDirectory, [], {
        environment: {
            LASTFM_API_KEY: undefined,
            MUSICBRAINZ_USER_AGENT: "SoundTag/1.0 (test@example.com)",
        },
    });

    assert.equal(exitCode, 1);
    assert.equal(
        stderr,
        "Error: Browsing folders needs an interactive terminal; pass a source folder instead.\n"
    );
});

test("CLI reads the API key from the user config .env", async () => {
    const workingDirectory = await createTemporaryDirectory();
    await fs.mkdir(path.join(workingDirectory, "soundtag"));
    await fs.writeFile(
        path.join(workingDirectory, "soundtag", ".env"),
        "LASTFM_API_KEY=from-config\n"
    );

    const { exitCode, stdout } = await runCli(workingDirectory, ["."], {
        environment: {
            LASTFM_API_KEY: undefined,
            MUSICBRAINZ_USER_AGENT: "SoundTag/1.0 (test@example.com)",
        },
    });

    assert.equal(exitCode, 0);
    assert.doesNotMatch(stdout, /Last\.fm lookup requires LASTFM_API_KEY\./);
});

test("CLI runs without a Last.fm key", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const { exitCode, stdout } = await runCli(workingDirectory, ["."], {
        environment: {
            LASTFM_API_KEY: undefined,
            MUSICBRAINZ_USER_AGENT: "SoundTag/1.0 (test@example.com)",
        },
    });

    assert.equal(exitCode, 0);
    assert.match(stdout, /Last\.fm lookup requires LASTFM_API_KEY\./);
});
