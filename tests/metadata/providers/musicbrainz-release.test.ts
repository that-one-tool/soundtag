import assert from "node:assert/strict";
import { test } from "node:test";
import {
    getFirstReleaseYear,
    getTrackPositionExtras,
} from "../../../src/metadata/providers/musicbrainz-release.js";

const theWall = {
    "release-group": { "first-release-date": "1979-11-30" },
    media: [
        {
            position: 1,
            "track-count": 13,
            tracks: [{ position: 1, recording: { id: "in-the-flesh" } }],
        },
        {
            position: 2,
            "track-count": 13,
            tracks: [
                { position: 5, recording: { id: "vera" } },
                {
                    position: 6,
                    recording: {
                        id: "comfortably-numb",
                        "first-release-date": "1979-11-30",
                    },
                },
            ],
        },
    ],
};

test("getTrackPositionExtras finds the track and disc of a recording", () => {
    assert.deepEqual(getTrackPositionExtras(theWall, "comfortably-numb"), {
        trackNumber: 6,
        trackCount: 13,
        discNumber: 2,
        discCount: 2,
    });
});

test("getTrackPositionExtras gives nothing for a recording not on the release", () => {
    assert.deepEqual(getTrackPositionExtras(theWall, "other"), {});
    assert.deepEqual(getTrackPositionExtras({}, "vera"), {});
});

test("getTrackPositionExtras leaves out unknown positions", () => {
    const sparse = { media: [{ tracks: [{ recording: { id: "vera" } }] }] };

    assert.deepEqual(getTrackPositionExtras(sparse, "vera"), { discCount: 1 });
});

test("getFirstReleaseYear takes the recording's first release on a compilation", () => {
    const compilation = {
        ...theWall,
        "release-group": { "first-release-date": "2010" },
    };

    assert.equal(getFirstReleaseYear(compilation, "comfortably-numb"), "1979");
    assert.equal(getFirstReleaseYear({}, "vera"), "");
});

test("getFirstReleaseYear takes the album's first release for a remastered recording", () => {
    const remaster = {
        "release-group": { "first-release-date": "1979-11-30" },
        media: [
            {
                tracks: [
                    {
                        recording: {
                            id: "remastered-numb",
                            "first-release-date": "1984-09",
                        },
                    },
                ],
            },
        ],
    };

    assert.equal(getFirstReleaseYear(remaster, "remastered-numb"), "1979");
    assert.equal(getFirstReleaseYear(theWall, "vera"), "1979");
});
