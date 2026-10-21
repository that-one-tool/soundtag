import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { loadSessionConfig, resolveSourceRoot } from "../../src/cli/config.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-config-test-"
);

test("loadSessionConfig reads arguments and environment", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const config = loadSessionConfig({
        argv: ["music", "--no-recursive", "-v", "--no-rename", "--fix"],
        env: {
            LASTFM_API_KEY: "lastfm-key",
            MUSICBRAINZ_USER_AGENT: "SoundTag/1.0",
            YOUTUBE_API_KEY: "youtube-key",
            LISTENBRAINZ_TOKEN: "listenbrainz-token",
            SOUNDTAG_COVER: "blocks",
        },
        workingDirectory,
    });

    assert.deepEqual(config, {
        sourcePath: "music",
        settings: {
            lastFmApiKey: "lastfm-key",
            recursive: false,
            verbose: true,
            renameFiles: false,
            fixTags: true,
            musicBrainzUserAgent: "SoundTag/1.0",
            youtubeApiKey: "youtube-key",
            listenBrainzToken: "listenbrainz-token",
            coverMode: "blocks",
        },
    });
});

test("loadSessionConfig runs without any API key", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const config = loadSessionConfig({ argv: [], env: {}, workingDirectory });

    assert.equal(config.settings.lastFmApiKey, undefined);
    assert.equal(config.settings.recursive, true);
    assert.equal(config.sourcePath, undefined);
});

test("loadSessionConfig rejects an unknown option or cover mode", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const load = (argv: string[], env: NodeJS.ProcessEnv) => () =>
        loadSessionConfig({ argv, env, workingDirectory });

    assert.throws(
        load(["--unknown"], {}),
        /^Error: Unknown option: --unknown$/
    );
    assert.throws(
        load([], { SOUNDTAG_COVER: "sixel" }),
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
