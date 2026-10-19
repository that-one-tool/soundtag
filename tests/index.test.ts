import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import NodeID3 from "node-id3";
import { afterEach, test } from "node:test";

const temporaryDirectories: string[] = [];
const projectRoot = process.cwd();
const tsxLoader = path.join(projectRoot, "node_modules/tsx/dist/loader.mjs");

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map((directory) =>
            fs.rm(directory, { recursive: true, force: true })
        )
    );
});

async function createTemporaryDirectory(): Promise<string> {
    const directory = await fs.mkdtemp(
        path.join(os.tmpdir(), "soundtag-cli-test-")
    );
    temporaryDirectories.push(directory);
    return directory;
}

function runCli(
    workingDirectory: string,
    args: string[]
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(
            process.execPath,
            ["--import", tsxLoader, path.join(projectRoot, "src/index.ts"), ...args],
            {
                cwd: workingDirectory,
                env: { ...process.env, LASTFM_API_KEY: "test-key" },
                stdio: ["ignore", "pipe", "pipe"],
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
        child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
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

    const { exitCode, stdout, stderr } = await runCli(
        workingDirectory,
        [sourceDirectory, "--no-recursive"]
    );

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
    const { exitCode, stdout, stderr } = await runCli(
        workingDirectory,
        ["--unknown"]
    );

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
