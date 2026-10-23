import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "ink-testing-library";
import { Box, Text } from "ink";
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

type PanelDefaults = "loading" | "cover" | "detailRows" | "width" | "cellRatio";

function renderPanel(
    props: Omit<MetadataPanelProps, PanelDefaults> &
        Partial<Pick<MetadataPanelProps, PanelDefaults>>
): string {
    const defaults = {
        loading: false,
        cover: null,
        detailRows: 40,
        width: 52,
        cellRatio: 2,
    };
    const panel = createElement(MetadataPanel, { ...defaults, ...props });
    return render(panel).lastFrame() ?? "";
}

test("MetadataPanel shows a loading state", () => {
    const frame = renderPanel({
        entry: undefined,
        details: null,
        statuses: new Map(),
    });

    assert.ok(frame.includes("Loading"));
});

test("MetadataPanel marks its header while newer details load", () => {
    const props = {
        entry: { name: "..", path: "/", kind: "parent" as const },
        details: { kind: "parent" as const },
        statuses: new Map(),
    };

    assert.match(renderPanel({ ...props, loading: true }), /Metadata …/);
    assert.doesNotMatch(renderPanel({ ...props, loading: false }), /…/);
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
                extras: {},
                hasCover: true,
            },
            track: EMPTY_TRACK,
        },
    });

    assert.match(frame, /Status\s+SKIPPED/);
    assert.match(frame, /Cover\s+yes/);
    assert.match(frame, /Title\s+—/);
    assert.ok(!frame.includes("Album artist"));
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
                extras: { albumArtist: "AC/DC" },
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
    assert.match(frame, /Album artist\s+AC\/DC/);
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

const COVER = { width: 48, height: 48, pixels: new Uint8Array(48 * 48 * 3) };

function createFileProps() {
    return {
        entry: { name: "a.mp3", path: "/a.mp3", kind: "file" as const },
        statuses: new Map(),
        details: {
            kind: "file" as const,
            format: "MP3",
            tags: {
                info: { title: "", artist: "", album: "", year: "" },
                extras: {},
                hasCover: true,
            },
            track: EMPTY_TRACK,
        },
        cover: COVER,
    };
}

function getCoverLines(frame: string): string[] {
    return frame
        .split("\n")
        .map((line) => line.match(/▀+/)?.[0] ?? "")
        .filter(Boolean);
}

test("MetadataPanel draws the whole cover below the fields when it fits", () => {
    const frame = renderPanel({ ...createFileProps(), detailRows: 36 });

    const coverLines = getCoverLines(frame);
    assert.equal(coverLines.length, 24);
    assert.equal(coverLines[0].length, 48);
    assert.ok(frame.indexOf("▀") > frame.indexOf("File"));
});

test("MetadataPanel shrinks the cover to the free rows", () => {
    const frame = renderPanel({ ...createFileProps(), detailRows: 20 });

    const coverLines = getCoverLines(frame);
    assert.equal(coverLines.length, 8);
    assert.equal(coverLines[0].length, 16);
});

test("MetadataPanel keeps half-block covers two pixels per row in taller cells", () => {
    const frame = renderPanel({
        ...createFileProps(),
        detailRows: 36,
        width: 58,
        cellRatio: 2.25,
    });

    const coverLines = getCoverLines(frame);
    assert.equal(coverLines.length, 24);
    assert.equal(coverLines[0].length, 48);
});

test("MetadataPanel leaves out a cover that would be too small", () => {
    const frame = renderPanel({ ...createFileProps(), detailRows: 19 });

    assert.ok(!frame.includes("▀"));
});

test("MetadataPanel shrinks the cover to its width", () => {
    const frame = renderPanel({ ...createFileProps(), width: 31 });

    const coverLines = getCoverLines(frame);
    assert.equal(coverLines[0].length, 26);
    assert.equal(coverLines.length, 13);
});

test("MetadataPanel keeps its width beside a long file name", () => {
    const longName = createElement(
        Box,
        { flexGrow: 1 },
        createElement(Text, { wrap: "truncate" }, "x".repeat(90))
    );
    const panel = createElement(MetadataPanel, {
        ...createFileProps(),
        loading: false,
        detailRows: 36,
        width: 52,
        cellRatio: 2,
    });

    const frame =
        render(createElement(Box, null, longName, panel)).lastFrame() ?? "";

    assert.equal(getCoverLines(frame)[0].length, 48);
});
