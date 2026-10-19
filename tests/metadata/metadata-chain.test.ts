import { consoleLogger } from "../../src/shared/logger.js";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MetadataChain } from "../../src/metadata/metadata-chain.js";
import { createRecordingLogger } from "../helpers/logger.js";
import type {
    CoverProvider,
    MetadataProvider,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../../src/metadata/types.js";

const originalConsoleLog = console.log;
const emptyInfo: TrackInfo = { title: "", artist: "", album: "", year: "" };
const search: TrackSearch = { title: "Query", artist: "Artist", album: "" };
const cover = Buffer.from("cover");

let output: string[] = [];

beforeEach(() => {
    output = [];
    console.log = (message: string) => output.push(message);
});

afterEach(() => {
    console.log = originalConsoleLog;
});

class FakeMetadataProvider implements MetadataProvider {
    readonly calls: { search: TrackSearch; needsCover: boolean }[] = [];

    constructor(private readonly result: TrackMetadata | null) {}

    async findMetadata(
        providerSearch: TrackSearch,
        needsCover: boolean
    ): Promise<TrackMetadata | null> {
        this.calls.push({ search: providerSearch, needsCover });
        return this.result;
    }
}

class FakeCoverProvider implements CoverProvider {
    readonly searches: TrackSearch[] = [];

    constructor(private readonly foundCover: Buffer | null) {}

    async findCover(coverSearch: TrackSearch): Promise<Buffer | null> {
        this.searches.push(coverSearch);
        return this.foundCover;
    }
}

function createMetadata(
    info: Partial<TrackInfo>,
    coverData: Buffer | null = null
): TrackMetadata {
    return { info: { ...emptyInfo, ...info }, coverData };
}

test("MetadataChain returns null without asking for a cover when nothing matches", async () => {
    const coverProvider = new FakeCoverProvider(cover);
    const chain = new MetadataChain(
        [new FakeMetadataProvider(null), new FakeMetadataProvider(null)],
        coverProvider,
        consoleLogger
    );

    assert.equal(await chain.find(search, emptyInfo), null);
    assert.deepEqual(coverProvider.searches, []);
});

test("MetadataChain fills missing fields in provider order without overwriting", async () => {
    const chain = new MetadataChain(
        [
            new FakeMetadataProvider(
                createMetadata({ title: "First", album: "" })
            ),
            new FakeMetadataProvider(
                createMetadata(
                    { title: "Second", artist: "Second", album: "Album" },
                    cover
                )
            ),
        ],
        undefined,
        consoleLogger
    );

    assert.deepEqual(await chain.find(search, { ...emptyInfo, year: "2020" }), {
        info: {
            title: "First",
            artist: "Second",
            album: "Album",
            year: "2020",
        },
        coverData: cover,
    });
});

test("MetadataChain stops asking providers once metadata is complete", async () => {
    const lastProvider = new FakeMetadataProvider(null);
    const chain = new MetadataChain(
        [
            new FakeMetadataProvider(
                createMetadata(
                    { title: "T", artist: "A", album: "B", year: "2000" },
                    cover
                )
            ),
            lastProvider,
        ],
        undefined,
        consoleLogger
    );

    await chain.find(search, emptyInfo);

    assert.deepEqual(lastProvider.calls, []);
});

test("MetadataChain searches with collected info and only requests missing covers", async () => {
    const secondProvider = new FakeMetadataProvider(null);
    const firstProvider = new FakeMetadataProvider(
        createMetadata({ title: "Found title" }, cover)
    );
    const chain = new MetadataChain(
        [firstProvider, secondProvider],
        undefined,
        consoleLogger
    );

    await chain.find(search, emptyInfo);

    assert.deepEqual(firstProvider.calls, [{ search, needsCover: true }]);
    assert.deepEqual(secondProvider.calls, [
        {
            search: { title: "Found title", artist: "Artist", album: "" },
            needsCover: false,
        },
    ]);
});

test("MetadataChain uses the cover provider only when matched metadata lacks a cover", async () => {
    const coverProvider = new FakeCoverProvider(cover);
    const chain = new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Found" }))],
        coverProvider,
        consoleLogger
    );

    const metadata = await chain.find(search, emptyInfo);

    assert.equal(metadata?.coverData, cover);
    assert.deepEqual(coverProvider.searches, [
        { title: "Found", artist: "Artist", album: "" },
    ]);
});

test("MetadataChain skips the cover provider when a cover was found", async () => {
    const coverProvider = new FakeCoverProvider(Buffer.from("other"));
    const chain = new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Found" }, cover))],
        coverProvider,
        consoleLogger
    );

    assert.equal((await chain.find(search, emptyInfo))?.coverData, cover);
    assert.deepEqual(coverProvider.searches, []);
});

test("MetadataChain reports whether a cover was found", async () => {
    const chain = new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Found" }))],
        new FakeCoverProvider(null),
        consoleLogger
    );

    assert.equal((await chain.find(search, emptyInfo))?.coverData, null);
    assert.deepEqual(output, ["Cover: unavailable"]);

    output = [];
    await new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Found" }, cover))],
        undefined,
        consoleLogger
    ).find(search, emptyInfo);
    assert.deepEqual(output, ["Cover: downloaded"]);
});

test("MetadataChain reports the cover result to the injected logger", async () => {
    const logger = createRecordingLogger();
    const chain = new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Title" }, cover))],
        undefined,
        logger
    );

    await chain.find(search, emptyInfo);

    assert.deepEqual(logger.infos, ["Cover: downloaded"]);
    assert.deepEqual(output, []);
});
