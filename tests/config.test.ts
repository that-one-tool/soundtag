import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { loadConfig, type Ask } from "../src/config.js";
import { useTemporaryDirectories } from "./helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-config-test-"
);

function createAsk(answers: Record<string, string>): {
    ask: Ask;
    questions: string[];
} {
    const questions: string[] = [];
    return {
        questions,
        ask: async (question) => {
            questions.push(question);
            return answers[question] ?? "";
        },
    };
}

test("loadConfig reads arguments and environment without prompting", async () => {
    const workingDirectory = await createTemporaryDirectory();
    await fs.mkdir(path.join(workingDirectory, "music"));
    const { ask, questions } = createAsk({});

    const config = await loadConfig({
        argv: ["music", "--no-recursive", "-v"],
        env: {
            LASTFM_API_KEY: " lastfm-key ",
            MUSICBRAINZ_USER_AGENT: "SoundTag/1.0",
            YOUTUBE_API_KEY: "youtube-key",
        },
        ask,
        workingDirectory,
    });

    assert.deepEqual(config, {
        lastFmApiKey: "lastfm-key",
        sourceRoot: path.join(workingDirectory, "music"),
        recursive: false,
        verbose: true,
        musicBrainzUserAgent: "SoundTag/1.0",
        youtubeApiKey: "youtube-key",
    });
    assert.deepEqual(questions, []);
});

test("loadConfig prompts for a missing API key and source folder", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const { ask, questions } = createAsk({
        "Enter your Last.fm API key: ": "prompted-key",
        "Enter the source folder path: ": ` ${workingDirectory} `,
    });

    const config = await loadConfig({
        argv: [],
        env: {},
        ask,
        workingDirectory,
    });

    assert.equal(config.lastFmApiKey, "prompted-key");
    assert.equal(config.sourceRoot, workingDirectory);
    assert.equal(config.recursive, true);
    assert.deepEqual(questions, [
        "Enter your Last.fm API key: ",
        "Enter the source folder path: ",
    ]);
});

test("loadConfig rejects missing or invalid required values", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const { ask } = createAsk({});
    const load = (argv: string[], env: NodeJS.ProcessEnv) =>
        loadConfig({ argv, env, ask, workingDirectory });
    const withKey = { LASTFM_API_KEY: "key" };

    await assert.rejects(
        load([], { LASTFM_API_KEY: " " }),
        /^Error: A Last\.fm API key is required\.$/
    );
    await assert.rejects(
        load([], withKey),
        /^Error: A source folder is required\.$/
    );
    await assert.rejects(
        load(["missing"], withKey),
        /^Error: The source folder does not exist\.$/
    );
    await assert.rejects(
        load(["--unknown"], withKey),
        /^Error: Unknown option: --unknown$/
    );
});
