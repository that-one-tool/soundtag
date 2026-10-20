import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import {
    loadSessionConfig,
    resolveSourceRoot,
    type Ask,
} from "../../src/cli/config.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

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

test("loadSessionConfig reads arguments and environment without prompting", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const { ask, questions } = createAsk({});

    const config = await loadSessionConfig({
        argv: ["music", "--no-recursive", "-v", "--no-rename"],
        env: {
            LASTFM_API_KEY: " lastfm-key ",
            MUSICBRAINZ_USER_AGENT: "SoundTag/1.0",
            YOUTUBE_API_KEY: "youtube-key",
            SOUNDTAG_COVER: "blocks",
        },
        ask,
        workingDirectory,
    });

    assert.deepEqual(config, {
        sourcePath: "music",
        settings: {
            lastFmApiKey: "lastfm-key",
            recursive: false,
            verbose: true,
            renameFiles: false,
            musicBrainzUserAgent: "SoundTag/1.0",
            youtubeApiKey: "youtube-key",
            coverMode: "blocks",
        },
    });
    assert.deepEqual(questions, []);
});

test("loadSessionConfig prompts only for a missing API key", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const { ask, questions } = createAsk({
        "Enter your Last.fm API key: ": "prompted-key",
    });

    const config = await loadSessionConfig({
        argv: [],
        env: {},
        ask,
        workingDirectory,
    });

    assert.equal(config.settings.lastFmApiKey, "prompted-key");
    assert.equal(config.settings.recursive, true);
    assert.equal(config.sourcePath, undefined);
    assert.deepEqual(questions, ["Enter your Last.fm API key: "]);
});

test("loadSessionConfig rejects a missing API key or an unknown option", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const { ask } = createAsk({});
    const load = (argv: string[], env: NodeJS.ProcessEnv) =>
        loadSessionConfig({ argv, env, ask, workingDirectory });

    await assert.rejects(
        load([], { LASTFM_API_KEY: " " }),
        /^Error: A Last\.fm API key is required\.$/
    );
    await assert.rejects(
        load(["--unknown"], { LASTFM_API_KEY: "key" }),
        /^Error: Unknown option: --unknown$/
    );
    await assert.rejects(
        load([], { LASTFM_API_KEY: "key", SOUNDTAG_COVER: "sixel" }),
        /^Error: SOUNDTAG_COVER must be kitty, blocks or none\.$/
    );
});

test("resolveSourceRoot resolves an existing folder from the working directory", async () => {
    const workingDirectory = await createTemporaryDirectory();
    await fs.mkdir(path.join(workingDirectory, "music"));

    assert.equal(
        await resolveSourceRoot(" music ", workingDirectory),
        path.join(workingDirectory, "music")
    );
});

test("resolveSourceRoot rejects a blank or missing folder", async () => {
    const workingDirectory = await createTemporaryDirectory();

    await assert.rejects(
        resolveSourceRoot(" ", workingDirectory),
        /^Error: A source folder is required\.$/
    );
    await assert.rejects(
        resolveSourceRoot("missing", workingDirectory),
        /^Error: The source folder does not exist\.$/
    );
});
