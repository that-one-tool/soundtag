import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import {
    MetadataPanel,
    type MetadataPanelProps,
} from "../../../src/tui/components/metadata-panel.js";

afterEach(() => cleanup());

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
        },
    });

    assert.match(frame, /Status\s+SKIPPED/);
    assert.match(frame, /Cover\s+yes/);
    assert.match(frame, /Title\s+—/);
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
