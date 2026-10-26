import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { MetadataChain } from "../../src/metadata/metadata-chain.js";
import { createRecordingLogger } from "../helpers/logger.js";
import type {
    CoverProvider,
    ExistingTags,
    MetadataProvider,
    ProviderNeeds,
    TrackExtras,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../../src/metadata/types.js";
import { createProviderServices } from "../helpers/metadata-chain.js";
import { BatchCache } from "../../src/shared/batch-cache.js";
import { ImageCache } from "../../src/shared/image-cache.js";
import { ServiceError } from "../../src/shared/errors.js";

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
    readonly calls: { search: TrackSearch; needs: ProviderNeeds }[] = [];

    constructor(
        private readonly result: TrackMetadata | null,
        readonly name = "Fake"
    ) {}

    async findMetadata(
        providerSearch: TrackSearch,
        needs: ProviderNeeds
    ): Promise<TrackMetadata | null> {
        this.calls.push({ search: providerSearch, needs });
        return this.result;
    }
}

class FakeCoverProvider implements CoverProvider {
    readonly searches: TrackSearch[] = [];

    constructor(
        private readonly foundCover: Buffer | null,
        readonly name = "FakeCover"
    ) {}

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
        [coverProvider],
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
        [],
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
        [],
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
        [],
        createProviderServices()
    );

    await chain.find(search, emptyTags);

    assert.deepEqual(firstProvider.calls, [
        { search, needs: { cover: true, details: true } },
    ]);
    assert.deepEqual(secondProvider.calls, [
        {
            search: { title: "Found title", artist: "Artist", album: "" },
            needs: { cover: false, details: true },
        },
    ]);
});

const allExtras: TrackExtras = {
    genre: "Rock",
    albumArtist: "Artist",
    trackNumber: 1,
    discNumber: 1,
};

test("MetadataChain asks for details until the year and every extra are known", async () => {
    const provider = new FakeMetadataProvider(null);
    const chain = new MetadataChain([provider], [], createProviderServices());
    const knownInfo = { ...emptyInfo, year: "2000" };

    await chain.find(search, {
        ...emptyTags,
        info: knownInfo,
        extras: allExtras,
    });
    await chain.find(search, { ...emptyTags, extras: allExtras });
    await chain.find(search, {
        ...emptyTags,
        info: knownInfo,
        extras: { ...allExtras, discNumber: undefined },
    });

    assert.deepEqual(
        provider.calls.map(({ needs }) => needs.details),
        [false, true, true]
    );
});

test("MetadataChain uses the cover provider only when matched metadata lacks a cover", async () => {
    const coverProvider = new FakeCoverProvider(cover);
    const chain = new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Found" }))],
        [coverProvider],
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
        [coverProvider],
        createProviderServices()
    );

    assert.equal((await chain.find(search, emptyTags))?.coverData, cover);
    assert.deepEqual(coverProvider.searches, []);
});

function findInStep(chain: MetadataChain, existing = emptyTags) {
    return chain.lookups.step({ label: "search" }, () =>
        chain.find(search, existing)
    );
}

test("MetadataChain tries cover providers in order until one finds a cover", async () => {
    const providers = [
        new FakeCoverProvider(null, "First"),
        new FakeCoverProvider(cover, "Second"),
        new FakeCoverProvider(Buffer.from("other"), "Third"),
    ];
    const logger = createRecordingLogger();
    const chain = new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Query" }))],
        providers,
        createProviderServices({ logger })
    );

    assert.equal((await findInStep(chain))?.coverData, cover);
    assert.deepEqual(
        providers.map(({ searches }) => searches.length),
        [1, 1, 0]
    );
    assert.deepEqual(logger.infos, [
        "  search Fake ✓ title 0.0s · First no match 0.0s · Second ✓ cover 0.0s",
    ]);
});

test("MetadataChain reports what each service added to the injected logger", async () => {
    const logger = createRecordingLogger();
    const chain = new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Query" }, cover))],
        [],
        createProviderServices({ logger })
    );

    await findInStep(chain);

    assert.deepEqual(logger.infos, ["  search Fake ✓ title, cover 0.0s"]);
    assert.deepEqual(output, []);
});

test("MetadataChain names a match on another song than the searched one", async () => {
    const logger = createRecordingLogger();
    const chain = new MetadataChain(
        [
            new FakeMetadataProvider(
                createMetadata({ title: "Other Song", artist: "Band" })
            ),
        ],
        [],
        createProviderServices({ logger })
    );

    await findInStep(chain, { ...emptyTags, hasCover: true });

    assert.deepEqual(logger.infos, [
        '  search Fake ✓ "Other Song" by Band: title, artist 0.0s',
    ]);
});

test("MetadataChain names another song even when it adds nothing", async () => {
    const logger = createRecordingLogger();
    const chain = new MetadataChain(
        [new FakeMetadataProvider(createMetadata({ title: "Other Song" }))],
        [],
        createProviderServices({ logger })
    );
    const existing = {
        ...emptyTags,
        info: { ...emptyInfo, title: "Query" },
        hasCover: true,
    };

    await findInStep(chain, existing);

    assert.deepEqual(logger.infos, ['  search Fake ✓ "Other Song" 0.0s']);
});

test("MetadataChain carries on after a failing service", async () => {
    const logger = createRecordingLogger();
    const broken: MetadataProvider = {
        name: "Broken",
        findMetadata: async () => {
            throw new ServiceError("Broken request failed: HTTP 500");
        },
    };
    const chain = new MetadataChain(
        [broken, new FakeMetadataProvider(createMetadata({ title: "Query" }))],
        [],
        createProviderServices({ logger })
    );

    const metadata = await findInStep(chain, { ...emptyTags, hasCover: true });

    assert.equal(metadata?.info.title, "Query");
    assert.deepEqual(logger.infos, [
        "  search Broken ✗ HTTP 500 0.0s · Fake ✓ title 0.0s",
    ]);
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
        [],
        createProviderServices()
    );
    const existing = { ...emptyTags, extras: { genre: "Rock" } };

    const metadata = await chain.find(search, existing);

    assert.deepEqual(metadata?.extras, { genre: "Rock", trackNumber: 4 });
});

test("MetadataChain keeps an existing cover without downloading another", async () => {
    const provider = new FakeMetadataProvider(
        createMetadata({ title: "Query" })
    );
    const coverProvider = new FakeCoverProvider(cover);
    const logger = createRecordingLogger();
    const chain = new MetadataChain(
        [provider],
        [coverProvider],
        createProviderServices({ logger })
    );

    const metadata = await findInStep(chain, { ...emptyTags, hasCover: true });

    assert.equal(metadata?.coverData, null);
    assert.equal(provider.calls[0].needs.cover, false);
    assert.deepEqual(coverProvider.searches, []);
    assert.deepEqual(logger.infos, ["  search Fake ✓ title 0.0s"]);
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
        [],
        createProviderServices()
    );

    await chain.find(search, { ...emptyTags, hasCover: true });

    assert.deepEqual(lastProvider.calls, []);
});

test("MetadataChain logs each service it queries and the cover search", async () => {
    const logger = createRecordingLogger();
    const chain = new MetadataChain(
        [
            new FakeMetadataProvider(null, "First"),
            new FakeMetadataProvider(
                createMetadata({ title: "Query" }),
                "Second"
            ),
        ],
        [new FakeCoverProvider(cover)],
        createProviderServices({ logger })
    );

    await findInStep(chain);

    assert.deepEqual(logger.infos, [
        "  search First no match 0.0s · Second ✓ title 0.0s · FakeCover ✓ cover 0.0s",
    ]);
});

test("clearCache clears the shared image and batch caches", async () => {
    const images = new ImageCache();
    const cache = new BatchCache();
    let imageClears = 0;
    images.clear = () => {
        imageClears += 1;
    };
    await cache.getOrLoad("key", async () => "first");

    new MetadataChain(
        [],
        [],
        createProviderServices({ images, cache })
    ).clearCache();

    assert.equal(imageClears, 1);
    assert.equal(await cache.getOrLoad("key", async () => "second"), "second");
});
