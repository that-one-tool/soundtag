import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { MetadataChain } from "../../src/metadata/metadata-chain.js";
import type { TrackSearch } from "../../src/metadata/types.js";
import { tagCoverOnly } from "../../src/processing/cover-only.js";
import { getTagStore } from "../../src/tags/audio-tags.js";
import type { StoredTags } from "../../src/tags/types.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import { createRecordingLogger } from "../helpers/logger.js";
import {
    createProviderServices,
    emptyInfo,
} from "../helpers/metadata-chain.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

restoreFetchAfterEach();
const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-cover-only-test-"
);

const info = {
    title: "Madison",
    artist: "Band",
    album: "Real Album",
    year: "",
};
const search: TrackSearch = {
    title: "Madison",
    artist: "Band",
    album: "Real Album",
};
async function createTrack(cover: string | null): Promise<string> {
    const source = path.join(await createTemporaryDirectory(), "track.mp3");
    await fs.writeFile(source, "audio bytes");
    await getTagStore(source).write(source, {
        info,
        extras: { genre: "Rock" },
        coverData: cover === null ? null : Buffer.from(cover),
    });
    return source;
}

function createChain(cover: string | null, searches: TrackSearch[] = []) {
    return new MetadataChain(
        [
            {
                name: "Fake",
                findMetadata: async (found) => {
                    searches.push(found);
                    return {
                        info: { ...emptyInfo, title: "Other", artist: "Band" },
                        extras: { trackNumber: 9 },
                        coverData: cover === null ? null : Buffer.from(cover),
                    };
                },
            },
        ],
        [],
        createProviderServices()
    );
}

async function runCoverOnly(
    source: string,
    options: {
        folderCover?: string;
        replaceCovers?: boolean;
        chain?: MetadataChain;
    } = {}
) {
    const logger = createRecordingLogger();
    const stored: StoredTags = await getTagStore(source).read(source);
    const albumLookups: string[] = [];
    const findFolderCover = async () => {
        albumLookups.push(source);
        const { folderCover } = options;
        return folderCover === undefined ? null : Buffer.from(folderCover);
    };
    const status = await tagCoverOnly(
        source,
        { stored, search, findFolderCover },
        {
            metadataChain: options.chain ?? createChain("found cover"),
            logger,
            replaceCovers: options.replaceCovers,
        }
    );
    return { status, logger, albumLookups };
}

test("tagCoverOnly writes the confirmed album's cover and nothing else", async () => {
    const source = await createTrack(null);
    const searches: TrackSearch[] = [];

    const { status, logger } = await runCoverOnly(source, {
        folderCover: "album cover",
        chain: createChain("found cover", searches),
    });

    assert.equal(status, "TAGGED");
    assert.deepEqual(searches, []);
    const tags = await getTagStore(source).read(source);
    assert.deepEqual(tags.info, info);
    assert.deepEqual(tags.extras, { genre: "Rock" });
    assert.deepEqual(
        await getTagStore(source).readCover(source),
        Buffer.from("album cover")
    );
    assert.deepEqual(logger.infos, ["  write  cover"]);
});

test("tagCoverOnly searches the services without a folder album cover", async () => {
    const source = await createTrack(null);
    const searches: TrackSearch[] = [];

    const { status } = await runCoverOnly(source, {
        chain: createChain("found cover", searches),
    });

    assert.equal(status, "TAGGED");
    assert.deepEqual(searches[0], search);
    assert.equal(
        (await getTagStore(source).read(source)).info.title,
        "Madison"
    );
    assert.deepEqual(
        await getTagStore(source).readCover(source),
        Buffer.from("found cover")
    );
});

test("tagCoverOnly keeps an existing cover unless replacing covers", async () => {
    const source = await createTrack("old cover");
    const before = await fs.readFile(source);

    const { status, logger, albumLookups } = await runCoverOnly(source, {
        folderCover: "album cover",
    });

    assert.equal(status, "SKIPPED");
    assert.deepEqual(albumLookups, []);
    assert.deepEqual(await fs.readFile(source), before);
    assert.deepEqual(logger.infos, ["  skip   already has a cover"]);
});

test("tagCoverOnly replaces an existing cover when replacing covers", async () => {
    const source = await createTrack("old cover");

    const { status } = await runCoverOnly(source, { replaceCovers: true });

    assert.equal(status, "TAGGED");
    assert.deepEqual(
        await getTagStore(source).readCover(source),
        Buffer.from("found cover")
    );
});

test("tagCoverOnly skips a file whose cover is the one found or when none is found", async () => {
    const same = await createTrack("found cover");
    const missing = await createTrack(null);

    const kept = await runCoverOnly(same, { replaceCovers: true });
    const notFound = await runCoverOnly(missing, { chain: createChain(null) });

    assert.equal(kept.status, "SKIPPED");
    assert.deepEqual(kept.logger.infos.at(-1), "  skip   no new cover");
    assert.equal(notFound.status, "SKIPPED");
});
