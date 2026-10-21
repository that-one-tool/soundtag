import assert from "node:assert/strict";
import { test } from "node:test";
import { TrackCorrector } from "../../src/metadata/track-corrector.js";
import type {
    CanonicalSource,
    CanonicalTrack,
    CorrectionRequest,
    TrackSearch,
} from "../../src/metadata/types.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { createProviderServices } from "../helpers/metadata-chain.js";

const search: TrackSearch = {
    title: "dancing queen",
    artist: "Abba",
    album: "Gold",
};

const splitSearch: TrackSearch = {
    title: "Stepping Out",
    artist: "Eric Clapton",
    album: "",
};

const fileSearch: TrackSearch = {
    title: "Stepping Out",
    artist: "Eric Clapton & The Powerhouse",
    album: "",
};

const steppingOut: CanonicalTrack = {
    title: "Stepping Out",
    artist: "Eric Clapton & The Powerhouse",
    firstReleaseYear: "1966",
    albums: [],
    artistAlbums: [],
};

const variousInfo = {
    title: "Eric Clapton - STEPPING OUT",
    artist: "Various Artists",
    album: "Blues",
    year: "1999",
};

const { lookups } = createProviderServices({ logger: createRecordingLogger() });

function createSource(
    findings: Record<string, CanonicalTrack>
): CanonicalSource & { searches: TrackSearch[] } {
    const searches: TrackSearch[] = [];
    return {
        name: "Fake",
        searches,
        findCanonical: async (asked) => {
            searches.push(asked);
            return findings[asked.artist] ?? null;
        },
    };
}

function createRequest(
    overrides: Partial<CorrectionRequest> = {}
): CorrectionRequest {
    return {
        tagSearch: search,
        alternatives: [
            {
                kind: "split title",
                search: splitSearch,
                replaces: ["title", "artist"],
            },
            {
                kind: "file name",
                search: fileSearch,
                replaces: ["title", "artist"],
            },
        ],
        hasSuspectTags: true,
        folderAlbum: "",
        ...overrides,
    };
}

function getChanges(corrections: { field: string; to: string }[]) {
    return corrections.map(({ field, to }) => [field, to]);
}

test("TrackCorrector asks every source and corrects from their findings", async () => {
    const spelling = createSource({
        Abba: {
            title: "Dancing Queen",
            artist: "ABBA",
            firstReleaseYear: "",
            albums: [],
            artistAlbums: [],
        },
    });
    const missing = createSource({});
    const year = createSource({
        Abba: {
            title: "Dancing queen",
            artist: "Abba",
            firstReleaseYear: "1976",
            albums: [],
            artistAlbums: [],
        },
    });
    const witness = createSource({});
    const corrector = new TrackCorrector(
        [spelling, missing, year],
        witness,
        lookups
    );

    const corrections = await corrector.findCorrections(
        createRequest({ hasSuspectTags: false }),
        { ...search, year: "2002" }
    );

    assert.deepEqual(getChanges(corrections), [
        ["title", "Dancing Queen"],
        ["artist", "ABBA"],
        ["year", "1976"],
    ]);
    assert.deepEqual(year.searches, [search]);
    assert.deepEqual(missing.searches, [search]);
    assert.deepEqual(witness.searches, []);
});

test("TrackCorrector replaces suspect tags when the witness agrees on an alternative", async () => {
    const source = createSource({
        "Eric Clapton & The Powerhouse": steppingOut,
    });
    const witness = createSource({
        "Eric Clapton & The Powerhouse": {
            title: "Stepping Out",
            artist: "Eric Clapton",
            firstReleaseYear: "",
            albums: [],
            artistAlbums: [],
        },
    });
    const corrector = new TrackCorrector([source], witness, lookups);

    const corrections = await corrector.findCorrections(
        createRequest(),
        variousInfo
    );

    assert.deepEqual(getChanges(corrections), [
        ["title", "Stepping Out"],
        ["artist", "Eric Clapton & The Powerhouse"],
        ["year", "1966"],
    ]);
    assert.deepEqual(source.searches, [search, splitSearch, fileSearch]);
    assert.deepEqual(witness.searches, [fileSearch]);
});

test("TrackCorrector tries the alternatives of trusted tags the sources do not find", async () => {
    const source = createSource({ "Eric Clapton": steppingOut });
    const witness = createSource({ "Eric Clapton": steppingOut });
    const corrector = new TrackCorrector([source], witness, lookups);

    const corrections = await corrector.findCorrections(
        createRequest({ hasSuspectTags: false }),
        variousInfo
    );

    assert.equal(corrections[1].to, "Eric Clapton & The Powerhouse");
    assert.deepEqual(source.searches, [search, splitSearch]);
});

test("TrackCorrector keeps trusted tags the sources find", async () => {
    const source = createSource({
        Abba: {
            title: "Dancing Queen",
            artist: "ABBA",
            firstReleaseYear: "",
            albums: [],
            artistAlbums: [],
        },
        "Eric Clapton": steppingOut,
    });
    const witness = createSource({ "Eric Clapton": steppingOut });
    const corrector = new TrackCorrector([source], witness, lookups);

    await corrector.findCorrections(createRequest({ hasSuspectTags: false }), {
        ...search,
        year: "",
    });

    assert.deepEqual(source.searches, [search]);
    assert.deepEqual(witness.searches, []);
});

test("TrackCorrector only respells when the witness finds another song", async () => {
    const source = createSource({
        Abba: {
            title: "Dancing Queen",
            artist: "ABBA",
            firstReleaseYear: "",
            albums: [],
            artistAlbums: [],
        },
        "Eric Clapton": steppingOut,
    });
    const witness = createSource({
        "Eric Clapton": {
            title: "Layla",
            artist: "Eric Clapton",
            firstReleaseYear: "",
            albums: [],
            artistAlbums: [],
        },
    });
    const corrector = new TrackCorrector([source], witness, lookups);

    const corrections = await corrector.findCorrections(createRequest(), {
        ...search,
        year: "",
    });

    assert.deepEqual(getChanges(corrections), [
        ["title", "Dancing Queen"],
        ["artist", "ABBA"],
    ]);
    assert.deepEqual(witness.searches, [splitSearch]);
});

test("TrackCorrector changes nothing when no alternative is confirmed", async () => {
    const source = createSource({ "Eric Clapton": steppingOut });
    const corrector = new TrackCorrector([source], createSource({}), lookups);

    const corrections = await corrector.findCorrections(
        createRequest(),
        variousInfo
    );

    assert.deepEqual(corrections, []);
});

test("TrackCorrector keeps the fields an alternative may not replace", async () => {
    const source = createSource({ "Eric Clapton": steppingOut });
    const witness = createSource({ "Eric Clapton": steppingOut });
    const corrector = new TrackCorrector([source], witness, lookups);
    const request = createRequest({
        alternatives: [
            { kind: "split title", search: splitSearch, replaces: ["artist"] },
        ],
    });

    const corrections = await corrector.findCorrections(request, {
        ...variousInfo,
        title: "stepping out",
    });

    assert.deepEqual(getChanges(corrections), [
        ["artist", "Eric Clapton & The Powerhouse"],
        ["year", "1966"],
    ]);
});

test("TrackCorrector skips an alternative whose song differs from the kept fields", async () => {
    const source = createSource({ "Eric Clapton": steppingOut });
    const witness = createSource({ "Eric Clapton": steppingOut });
    const corrector = new TrackCorrector([source], witness, lookups);
    const request = createRequest({
        alternatives: [
            { kind: "split title", search: splitSearch, replaces: ["artist"] },
        ],
    });

    const corrections = await corrector.findCorrections(request, {
        ...variousInfo,
        title: "Smile",
    });

    assert.deepEqual(corrections, []);
});

test("TrackCorrector tells whether it has any source", () => {
    assert.equal(
        new TrackCorrector([], createSource({}), lookups).canCorrect(),
        false
    );
    assert.equal(
        new TrackCorrector(
            [createSource({})],
            createSource({}),
            lookups
        ).canCorrect(),
        true
    );
});

test("TrackCorrector logs one line per search with each service", async () => {
    const logger = createRecordingLogger();
    const source = createSource({
        "Eric Clapton & The Powerhouse": steppingOut,
    });
    const witness = createSource({
        "Eric Clapton & The Powerhouse": steppingOut,
    });
    const corrector = new TrackCorrector(
        [source],
        witness,
        createProviderServices({ logger }).lookups
    );

    await corrector.findCorrections(createRequest(), variousInfo);

    assert.deepEqual(logger.infos, [
        "  check  Fake no match 0.0s",
        '  check  split title "Stepping Out" · Eric Clapton: Fake no match 0.0s',
        '  check  file name "Stepping Out" · Eric Clapton & The Powerhouse: Fake ✓ 0.0s · Fake ✓ 0.0s',
    ]);
});

const dancingQueen: CanonicalTrack = {
    title: "Dancing Queen",
    artist: "ABBA",
    firstReleaseYear: "",
    albums: ["Arrival", "Gold: Greatest Hits", "Now 45"],
    artistAlbums: ["Arrival", "Gold: Greatest Hits"],
};

const wrongAlbumInfo = {
    title: "Dancing Queen",
    artist: "ABBA",
    album: "The Half of It: A Memoir",
    year: "",
};

function correctAlbum(folderAlbum: string, witnessed: CanonicalTrack | null) {
    const logger = createRecordingLogger();
    const witness = createSource(witnessed ? { Abba: witnessed } : {});
    const corrector = new TrackCorrector(
        [createSource({ Abba: dancingQueen })],
        witness,
        createProviderServices({ logger }).lookups
    );
    const request = createRequest({ hasSuspectTags: false, folderAlbum });
    const found = corrector.findCorrections(request, wrongAlbumInfo);
    return { found, witness, logger };
}

test("TrackCorrector replaces a wrong album with the folder album the song is on", async () => {
    const { found, witness } = correctAlbum("arrival", dancingQueen);

    assert.deepEqual(await found, [
        { field: "album", from: "The Half of It: A Memoir", to: "Arrival" },
    ]);
    assert.deepEqual(witness.searches, []);
});

test("TrackCorrector replaces a wrong album with Deezer's when the song is on it", async () => {
    const deezer = { ...dancingQueen, albums: ["Gold - Greatest Hits"] };
    const { found, witness, logger } = correctAlbum("Downloads", deezer);

    assert.deepEqual(await found, [
        {
            field: "album",
            from: "The Half of It: A Memoir",
            to: "Gold: Greatest Hits",
        },
    ]);
    assert.deepEqual(witness.searches, [search]);
    assert.equal(
        logger.infos.at(-1),
        '  check  album "The Half of It: A Memoir": Fake ✓ 0.0s'
    );
});

test("TrackCorrector keeps a wrong album nothing confirms", async () => {
    const { found } = correctAlbum("Downloads", null);

    assert.deepEqual(await found, []);
});

test("TrackCorrector keeps an album its folder agrees with", async () => {
    const { found, witness } = correctAlbum(
        "The Half of It: A Memoir",
        dancingQueen
    );

    assert.deepEqual(await found, []);
    assert.deepEqual(witness.searches, []);
});

test("TrackCorrector ignores a folder named after the artist and a compilation from Deezer", async () => {
    const deezer = { ...dancingQueen, albums: ["Now 45"] };
    const { found } = correctAlbum("ABBA", deezer);

    assert.deepEqual(await found, []);
});
