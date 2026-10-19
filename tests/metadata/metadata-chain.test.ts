import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MetadataChain } from "../../src/metadata/metadata-chain.js";
import { createRecordingLogger } from "../helpers/logger.js";
import type {
    CoverProvider,
    ExistingTags,
    MetadataProvider,
    TrackExtras,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../../src/metadata/types.js";
import { createProviderServices } from "../helpers/metadata-chain.js";
import { ImageCache } from "../../src/shared/image-cache.js";

const originalConsoleLog = console.log;
const emptyInfo: TrackInfo = { title: "", artist: "", album: "", year: "" };
const emptyTags: ExistingTags = {
    info: emptyInfo,
    extras: {},
    hasCover: false,
};
const requiredExtras: TrackExtras = { genre: "Rock", trackNumber: 1 };
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

    constructor(
        private readonly result: TrackMetadata | null,
        readonly name = "Fake"
    ) {}

    async findMetadata(
        providerSearch: TrackSearch,
        needsCover: boolean
    ): Promise<TrackMetadata | null> {
        this.calls.push({ search: providerSearch, needsCover });
        return this.result;
    }
}

class FakeCoverProvider implements CoverProvider {
    readonly name = "FakeCover";
    readonly searches: TrackSearch[] = [];

    constructor(private readonly foundCover: Buffer | null) {}

    async findCover(coverSearch: TrackSearch): Promise<Buffer | null> {
        this.searches.push(coverSearch);
        return this.foundCover;
    }
}

function createMetadata(
    info: Partial<TrackInfo>,
    coverData: Buffer | null = null,
    extras: TrackExtras = {}
): TrackMetadata {
    return { info: { ...emptyInfo, ...info }, extras, coverData };
}

test("MetadataChain returns null without asking for a cover when nothing matches", async () => {
    const coverProvider = new FakeCoverProvider(cover);
    const chain = new MetadataChain(
        [new FakeMetadataProvider(null), new FakeMetadataProvider(null)],
        coverProvider,
        createProviderServices()
    );

    assert.equal(await chain.find(search, emptyTags), null);
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
        createProviderServices()
    );

    const existing = { ...emptyTags, info: { ...emptyInfo, year: "2020" } };

    assert.deepEqual(await chain.find(search, existing), {
        info: {
            title: "First",
            artist: "Second",
            album: "Album",
            year: "2020",
        },
        extras: {},
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
                    cover,
                    requiredExtras
                )
            ),
            lastProvider,
        ],
        undefined,
        createProviderServices()
    );

    await chain.find(search, emptyTags);

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
        createProviderServices()
    );

    await chain.find(search, emptyTags);

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
        createProviderServices()
    );

    const metadata = await chain.find(search, emptyTags);

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
        createProviderServices()
    );

    assert.equal((await chain.find(search, emptyTags))?.coverData, cover);
    assert.deepEqual(coverProvider.searches, []);
});

test("MetadataChain reports whether a cover was found", async () => {
    const chain = new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Found" }))],
        new FakeCoverProvider(null),
        createProviderServices()
    );

    assert.equal((await chain.find(search, emptyTags))?.coverData, null);
    assert.deepEqual(output, [
        "Querying Fake...",
        "Searching FakeCover for a cover...",
        "Cover: unavailable",
    ]);

    output = [];
    await new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Found" }, cover))],
        undefined,
        createProviderServices()
    ).find(search, emptyTags);
    assert.deepEqual(output, ["Querying Fake...", "Cover: downloaded"]);
});

test("MetadataChain reports the cover result to the injected logger", async () => {
    const logger = createRecordingLogger();
    const chain = new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Title" }, cover))],
        undefined,
        createProviderServices({ logger })
    );

    await chain.find(search, emptyTags);

    assert.deepEqual(logger.infos, ["Querying Fake...", "Cover: downloaded"]);
    assert.deepEqual(output, []);
});

test("MetadataChain keeps existing extras and fills the missing ones", async () => {
    const chain = new MetadataChain(
        [
            new FakeMetadataProvider(
                createMetadata({ title: "Found" }, null, {
                    genre: "Pop",
                    trackNumber: 4,
                })
            ),
        ],
        undefined,
        createProviderServices()
    );
    const existing = { ...emptyTags, extras: { genre: "Rock" } };

    const metadata = await chain.find(search, existing);

    assert.deepEqual(metadata?.extras, { genre: "Rock", trackNumber: 4 });
});

test("MetadataChain keeps an existing cover without downloading another", async () => {
    const provider = new FakeMetadataProvider(createMetadata({ title: "T" }));
    const coverProvider = new FakeCoverProvider(cover);
    const logger = createRecordingLogger();
    const chain = new MetadataChain(
        [provider],
        coverProvider,
        createProviderServices({ logger })
    );

    const metadata = await chain.find(search, { ...emptyTags, hasCover: true });

    assert.equal(metadata?.coverData, null);
    assert.equal(provider.calls[0].needsCover, false);
    assert.deepEqual(coverProvider.searches, []);
    assert.deepEqual(logger.infos, ["Querying Fake...", "Cover: kept"]);
});

test("MetadataChain counts an existing cover towards complete metadata", async () => {
    const lastProvider = new FakeMetadataProvider(null);
    const chain = new MetadataChain(
        [
            new FakeMetadataProvider(
                createMetadata(
                    { title: "T", artist: "A", album: "B", year: "2000" },
                    null,
                    requiredExtras
                )
            ),
            lastProvider,
        ],
        undefined,
        createProviderServices()
    );

    await chain.find(search, { ...emptyTags, hasCover: true });

    assert.deepEqual(lastProvider.calls, []);
});

test("MetadataChain logs each provider it queries and the cover search", async () => {
    const logger = createRecordingLogger();
    const chain = new MetadataChain(
        [
            new FakeMetadataProvider(null, "First"),
            new FakeMetadataProvider(createMetadata({ title: "T" }), "Second"),
        ],
        new FakeCoverProvider(cover),
        createProviderServices({ logger })
    );

    await chain.find(search, emptyTags);

    assert.deepEqual(logger.infos, [
        "Querying First...",
        "Querying Second...",
        "Searching FakeCover for a cover...",
        "Cover: downloaded",
    ]);
});

test("clearCache clears the shared image cache", () => {
    const images = new ImageCache();
    let clears = 0;
    images.clear = () => {
        clears += 1;
    };

    new MetadataChain(
        [],
        undefined,
        createProviderServices({ images })
    ).clearCache();

    assert.equal(clears, 1);
});
