import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import {
    MetadataPanel,
    type MetadataPanelProps,
} from "../../../src/tui/components/metadata-panel.js";

afterEach(() => cleanup());

const EMPTY_TRACK = {
    trackNumber: 0,
    trackCount: 0,
    discNumber: 0,
    discCount: 0,
    genre: "",
    durationMilliseconds: 0,
    bitrateKbps: 0,
    sampleRateHz: 0,
    channels: 0,
    sizeBytes: 0,
};

function renderPanel(props: MetadataPanelProps): string {
    return render(createElement(MetadataPanel, props)).lastFrame() ?? "";
}

test("MetadataPanel shows a loading state", () => {
    const frame = renderPanel({
        entry: undefined,
        details: null,
        statuses: new Map(),
    });

    assert.ok(frame.includes("Loading"));
});

test("MetadataPanel shows the session status of a file", () => {
    const frame = renderPanel({
        entry: { name: "a.mp3", path: "/a.mp3", kind: "file" },
        statuses: new Map([["/a.mp3", "SKIPPED" as const]]),
        details: {
            kind: "file",
            format: "MP3",
            tags: {
                info: { title: "", artist: "", album: "", year: "" },
                hasCover: true,
            },
            track: EMPTY_TRACK,
        },
    });

    assert.match(frame, /Status\s+SKIPPED/);
    assert.match(frame, /Cover\s+yes/);
    assert.match(frame, /Title\s+—/);
    assert.ok(frame.indexOf("Status") < frame.indexOf("Title"));
});

test("MetadataPanel shows the position, genre and audio properties of a file", () => {
    const frame = renderPanel({
        entry: { name: "a.flac", path: "/a.flac", kind: "file" },
        statuses: new Map(),
        details: {
            kind: "file",
            format: "FLAC",
            tags: {
                info: { title: "", artist: "", album: "", year: "" },
                hasCover: false,
            },
            track: {
                trackNumber: 3,
                trackCount: 12,
                discNumber: 1,
                discCount: 0,
                genre: "Rock",
                durationMilliseconds: 225_400,
                bitrateKbps: 1411.2,
                sampleRateHz: 22_050,
                channels: 2,
                sizeBytes: 4_404_019,
            },
        },
    });

    assert.match(frame, /Track\s+3\/12 · disc 1\s/);
    assert.match(frame, /Genre\s+Rock/);
    assert.match(frame, /Duration\s+3:45/);
    assert.match(frame, /Audio\s+1411 kbps · 22.05 kHz · stereo/);
    assert.match(frame, /File\s+FLAC · 4.2 MB/);
});

test("MetadataPanel counts session statuses inside a folder", () => {
    const frame = renderPanel({
        entry: { name: "Rock", path: "/Rock", kind: "folder" },
        statuses: new Map([["/Rock/a.mp3", "TAGGED" as const]]),
        details: { kind: "folder", audioFileCount: 3, subfolderCount: 2 },
    });

    assert.match(frame, /Subfolders\s+2/);
    assert.match(frame, /Tagged\s+1/);
    assert.match(frame, /Failed\s+0/);
});

test("MetadataPanel explains unreadable files", () => {
    const frame = renderPanel({
        entry: { name: "a.flac", path: "/a.flac", kind: "file" },
        statuses: new Map(),
        details: { kind: "unreadable", message: "Corrupt file" },
    });

    assert.ok(frame.includes("Corrupt file"));
});
