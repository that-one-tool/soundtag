import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { loadEnvFiles, type EnvFileSources } from "../../src/cli/env-file.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-env-file-test-"
);

async function writeEnvFile(
    directory: string,
    content: string
): Promise<string> {
    await fs.mkdir(directory, { recursive: true });
    const envFile = path.join(directory, ".env");
    await fs.writeFile(envFile, content);
    return envFile;
}

async function createSources(
    env: NodeJS.ProcessEnv = {}
): Promise<EnvFileSources & { warnings: string[] }> {
    const warnings: string[] = [];
    return {
        workingDirectory: await createTemporaryDirectory(),
        homeDirectory: await createTemporaryDirectory(),
        env,
        warn: (message) => warnings.push(message),
        warnings,
    };
}

function getDefaultConfigDirectory(sources: EnvFileSources): string {
    return path.join(sources.homeDirectory, ".config", "soundtag");
}

test("loadEnvFiles reads both files and the local value wins", async () => {
    const sources = await createSources();
    const localFile = await writeEnvFile(
        sources.workingDirectory,
        "LASTFM_API_KEY=local"
    );
    const configFile = await writeEnvFile(
        getDefaultConfigDirectory(sources),
        "LASTFM_API_KEY=global\nYOUTUBE_API_KEY=youtube\nSOUNDTAG_COVER=kitty\nLISTENBRAINZ_TOKEN=token"
    );

    assert.deepEqual(await loadEnvFiles(sources), [localFile, configFile]);
    assert.deepEqual(sources.env, {
        LASTFM_API_KEY: "local",
        YOUTUBE_API_KEY: "youtube",
        SOUNDTAG_COVER: "kitty",
        LISTENBRAINZ_TOKEN: "token",
    });
});

test("loadEnvFiles falls back to ~/.config/soundtag/.env", async () => {
    const sources = await createSources();
    const configFile = await writeEnvFile(
        getDefaultConfigDirectory(sources),
        "LASTFM_API_KEY=global"
    );

    assert.deepEqual(await loadEnvFiles(sources), [configFile]);
    assert.equal(sources.env.LASTFM_API_KEY, "global");
});

test("loadEnvFiles uses an absolute XDG_CONFIG_HOME", async () => {
    const configHome = await createTemporaryDirectory();
    const sources = await createSources({ XDG_CONFIG_HOME: configHome });
    await writeEnvFile(path.join(configHome, "soundtag"), "LASTFM_API_KEY=xdg");

    await loadEnvFiles(sources);

    assert.equal(sources.env.LASTFM_API_KEY, "xdg");
});

test("loadEnvFiles ignores an empty or relative XDG_CONFIG_HOME", async () => {
    for (const configHome of ["", "relative"]) {
        const sources = await createSources({ XDG_CONFIG_HOME: configHome });
        await writeEnvFile(
            getDefaultConfigDirectory(sources),
            "LASTFM_API_KEY=global"
        );

        await loadEnvFiles(sources);

        assert.equal(sources.env.LASTFM_API_KEY, "global");
    }
});

test("loadEnvFiles keeps variables that are already set", async () => {
    const sources = await createSources({ LASTFM_API_KEY: "from-shell" });
    await writeEnvFile(sources.workingDirectory, "LASTFM_API_KEY=local");

    await loadEnvFiles(sources);

    assert.equal(sources.env.LASTFM_API_KEY, "from-shell");
});

test("loadEnvFiles takes only SoundTag variables", async () => {
    const sources = await createSources();
    await writeEnvFile(
        sources.workingDirectory,
        "NODE_TLS_REJECT_UNAUTHORIZED=0\nMUSICBRAINZ_USER_AGENT=SoundTag/1.0"
    );

    await loadEnvFiles(sources);

    assert.deepEqual(sources.env, { MUSICBRAINZ_USER_AGENT: "SoundTag/1.0" });
});

test("loadEnvFiles loads nothing when no .env file exists", async () => {
    const sources = await createSources();
    await fs.mkdir(path.join(sources.workingDirectory, ".env"));

    assert.deepEqual(await loadEnvFiles(sources), []);
    assert.deepEqual(sources.env, {});
    assert.deepEqual(sources.warnings, []);
});

test(
    "loadEnvFiles warns about an unreadable file and still reads the next one",
    { skip: process.getuid?.() === 0 },
    async () => {
        const sources = await createSources();
        const localFile = await writeEnvFile(
            sources.workingDirectory,
            "LASTFM_API_KEY=local"
        );
        await fs.chmod(localFile, 0o000);
        await writeEnvFile(
            getDefaultConfigDirectory(sources),
            "LASTFM_API_KEY=global"
        );

        await loadEnvFiles(sources);

        assert.equal(sources.env.LASTFM_API_KEY, "global");
        assert.equal(sources.warnings.length, 1);
        assert.match(
            sources.warnings[0],
            /^Warning: cannot read .*\.env: .*EACCES/
        );
    }
);
