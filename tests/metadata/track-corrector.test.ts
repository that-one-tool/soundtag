import assert from "node:assert/strict";
import { test } from "node:test";
import { TrackCorrector } from "../../src/metadata/track-corrector.js";
import type {
    CanonicalSource,
    CanonicalTrack,
    CorrectionRequest,
    TrackSearch,
} from "../../src/metadata/types.js";

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
};

const variousInfo = {
    title: "Eric Clapton - STEPPING OUT",
    artist: "Various Artists",
    album: "Blues",
    year: "1999",
};

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
            { search: splitSearch, replaces: ["title", "artist"] },
            { search: fileSearch, replaces: ["title", "artist"] },
        ],
        hasSuspectTags: true,
        ...overrides,
    };
}

function getChanges(corrections: { field: string; to: string }[]) {
    return corrections.map(({ field, to }) => [field, to]);
}

test("TrackCorrector asks every source and corrects from their findings", async () => {
    const spelling = createSource({
        Abba: { title: "Dancing Queen", artist: "ABBA", firstReleaseYear: "" },
    });
    const missing = createSource({});
    const year = createSource({
        Abba: {
            title: "Dancing queen",
            artist: "Abba",
            firstReleaseYear: "1976",
        },
    });
    const witness = createSource({});
    const corrector = new TrackCorrector([spelling, missing, year], witness);

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
        },
    });
    const corrector = new TrackCorrector([source], witness);

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
    const corrector = new TrackCorrector([source], witness);

    const corrections = await corrector.findCorrections(
        createRequest({ hasSuspectTags: false }),
        variousInfo
    );

    assert.equal(corrections[1].to, "Eric Clapton & The Powerhouse");
    assert.deepEqual(source.searches, [search, splitSearch]);
});

test("TrackCorrector keeps trusted tags the sources find", async () => {
    const source = createSource({
        Abba: { title: "Dancing Queen", artist: "ABBA", firstReleaseYear: "" },
        "Eric Clapton": steppingOut,
    });
    const witness = createSource({ "Eric Clapton": steppingOut });
    const corrector = new TrackCorrector([source], witness);

    await corrector.findCorrections(createRequest({ hasSuspectTags: false }), {
        ...search,
        year: "",
    });

    assert.deepEqual(source.searches, [search]);
    assert.deepEqual(witness.searches, []);
});

test("TrackCorrector only respells when the witness finds another song", async () => {
    const source = createSource({
        Abba: { title: "Dancing Queen", artist: "ABBA", firstReleaseYear: "" },
        "Eric Clapton": steppingOut,
    });
    const witness = createSource({
        "Eric Clapton": {
            title: "Layla",
            artist: "Eric Clapton",
            firstReleaseYear: "",
        },
    });
    const corrector = new TrackCorrector([source], witness);

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
    const corrector = new TrackCorrector([source], createSource({}));

    const corrections = await corrector.findCorrections(
        createRequest(),
        variousInfo
    );

    assert.deepEqual(corrections, []);
});

test("TrackCorrector keeps the fields an alternative may not replace", async () => {
    const source = createSource({ "Eric Clapton": steppingOut });
    const witness = createSource({ "Eric Clapton": steppingOut });
    const corrector = new TrackCorrector([source], witness);
    const request = createRequest({
        alternatives: [{ search: splitSearch, replaces: ["artist"] }],
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
    const corrector = new TrackCorrector([source], witness);
    const request = createRequest({
        alternatives: [{ search: splitSearch, replaces: ["artist"] }],
    });

    const corrections = await corrector.findCorrections(request, {
        ...variousInfo,
        title: "Smile",
    });

    assert.deepEqual(corrections, []);
});

test("TrackCorrector tells whether it has any source", () => {
    assert.equal(new TrackCorrector([], createSource({})).canCorrect(), false);
    assert.equal(
        new TrackCorrector([createSource({})], createSource({})).canCorrect(),
        true
    );
});
