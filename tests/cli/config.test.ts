import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import {
    findSearchRoot,
    loadSessionConfig,
    resolveSources,
} from "../../src/cli/config.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-config-test-"
);

test("loadSessionConfig reads arguments and environment", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const config = loadSessionConfig({
        argv: ["music", "--no-recursive", "-v", "--overwrite"],
        env: {
            LASTFM_API_KEY: "lastfm-key",
            MUSICBRAINZ_USER_AGENT: "SoundTag/1.0",
            YOUTUBE_API_KEY: "youtube-key",
            LISTENBRAINZ_TOKEN: "listenbrainz-token",
            SOUNDTAG_COVER: "blocks",
            DISCOGS_CONSUMER_KEY: "discogs-key",
            DISCOGS_CONSUMER_SECRET: "discogs-secret",
        },
        workingDirectory,
    });

    assert.deepEqual(config, {
        sourcePaths: ["music"],
        settings: {
            lastFmApiKey: "lastfm-key",
            recursive: false,
            verbose: true,
            overwrite: true,
            json: false,
            musicBrainzUserAgent: "SoundTag/1.0",
            youtubeApiKey: "youtube-key",
            listenBrainzToken: "listenbrainz-token",
            coverMode: "blocks",
            discogsConsumerKey: "discogs-key",
            discogsConsumerSecret: "discogs-secret",
        },
    });
});

test("loadSessionConfig runs without any API key", async () => {
    const workingDirectory = await createTemporaryDirectory();

    const config = loadSessionConfig({ argv: [], env: {}, workingDirectory });

    assert.equal(config.settings.lastFmApiKey, undefined);
    assert.equal(config.settings.recursive, true);
    assert.deepEqual(config.sourcePaths, []);
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

async function createFiles(
    root: string,
    ...names: string[]
): Promise<string[]> {
    const files = names.map((name) => path.join(root, name));
    for (const file of files) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, "");
    }
    return files;
}

test("resolveSources resolves a folder as its own root", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const music = path.join(workingDirectory, "music");
    await fs.mkdir(music);

    assert.deepEqual(await resolveSources([" music "], workingDirectory), {
        root: music,
        folders: [music],
        files: [],
    });
});

test("resolveSources roots files at their deepest common folder", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const [queen, abba] = await createFiles(
        workingDirectory,
        "Queen/Queen - Jazz.mp3",
        "ABBA/ABBA - SOS.opus"
    );

    assert.deepEqual(
        await resolveSources([queen, "ABBA/ABBA - SOS.opus"], workingDirectory),
        { root: workingDirectory, folders: [], files: [queen, abba] }
    );
});

test("resolveSources roots a single file at its folder", async () => {
    const workingDirectory = await createTemporaryDirectory();
    const [song] = await createFiles(workingDirectory, "Queen/song.mp3");

    const sources = await resolveSources([song], workingDirectory);

    assert.equal(sources.root, path.join(workingDirectory, "Queen"));
});

test("resolveSources rejects blank, missing and non-audio sources", async () => {
    const workingDirectory = await createTemporaryDirectory();
    await createFiles(workingDirectory, "notes.txt");

    await assert.rejects(
        resolveSources([" "], workingDirectory),
        /^Error: A source folder is required\.$/
    );
    await assert.rejects(
        resolveSources(["missing"], workingDirectory),
        /^Error: Source not found: missing$/
    );
    await assert.rejects(
        resolveSources(["notes.txt"], workingDirectory),
        /^Error: Not a supported audio file: notes\.txt$/
    );
});

test("findSearchRoot starts from the given folder, the album folder or the file's folder", () => {
    const music = path.resolve("/music");
    const sources = {
        root: music,
        folders: [path.join(music, "Rock")],
        files: [],
    };
    const inFolder = path.join(music, "Rock", "Queen", "a.mp3");
    const album = path.join(music, "Queen", "Queen - Jazz");
    const single = path.join(music, "Downloads", "b.mp3");

    assert.equal(findSearchRoot(sources, inFolder), path.join(music, "Rock"));
    assert.equal(findSearchRoot(sources, path.join(album, "c.mp3")), album);
    assert.equal(findSearchRoot(sources, single), path.dirname(single));
});

test("findSearchRoot picks the deepest given folder whatever the order", () => {
    const music = path.resolve("/music");
    const rock = path.join(music, "Rock");
    const file = path.join(rock, "Queen", "a.mp3");

    for (const folders of [
        [music, rock],
        [rock, music],
    ]) {
        assert.equal(findSearchRoot({ folders, files: [] }, file), rock);
    }
});
