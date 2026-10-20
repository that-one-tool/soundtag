import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { cleanup, render } from "ink-testing-library";
import { createElement } from "react";
import { CoverPlacerContext } from "../../../src/tui/components/kitty-cover-view.js";
import {
    MetadataPanel,
    type MetadataPanelProps,
} from "../../../src/tui/components/metadata-panel.js";
import type { CoverPlacer } from "../../../src/tui/cover-overlay.js";
import type { CoverSpot, PngCover } from "../../../src/tui/types.js";
import { waitFor } from "../../helpers/ink.js";

afterEach(() => cleanup());

const PNG_COVER: PngCover = {
    png: Buffer.from("png"),
    key: "png",
    width: 48,
    height: 48,
};

function createRecordingPlacer() {
    const shown: { cover: PngCover; spot: CoverSpot }[] = [];
    let hidden = 0;
    const placer: CoverPlacer = {
        show: (cover, spot) => shown.push({ cover, spot }),
        hide: () => hidden++,
        invalidate: () => {},
        clear: () => {},
    };
    return { placer, shown, getHiddenCount: () => hidden };
}

function createPanelProps(detailRows: number): MetadataPanelProps {
    return {
        entry: { name: "a.mp3", path: "/a.mp3", kind: "file" },
        statuses: new Map(),
        details: {
            kind: "file",
            format: "MP3",
            tags: {
                info: { title: "", artist: "", album: "", year: "" },
                extras: {},
                hasCover: true,
            },
            track: {
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
            },
        },
        loading: false,
        cover: PNG_COVER,
        detailRows,
        width: 52,
    };
}

function renderWithPlacer(placer: CoverPlacer, props: MetadataPanelProps) {
    const panel = (panelProps: MetadataPanelProps) =>
        createElement(
            CoverPlacerContext.Provider,
            { value: placer },
            createElement(MetadataPanel, panelProps)
        );
    const instance = render(panel(props));
    return {
        ...instance,
        rerenderPanel: (next: MetadataPanelProps) =>
            instance.rerender(panel(next)),
    };
}

test("KittyCoverView places the cover over an empty box below the fields", async () => {
    const { placer, shown } = createRecordingPlacer();

    const { lastFrame } = renderWithPlacer(placer, createPanelProps(36));

    await waitFor(() => shown.length > 0);
    assert.equal(shown.at(-1)?.cover, PNG_COVER);
    assert.deepEqual(shown.at(-1)?.spot, {
        row: 14,
        column: 2,
        columns: 48,
        rows: 24,
    });
    assert.ok(!(lastFrame() ?? "").includes("▀"));
});

test("KittyCoverView shrinks the cover box to the free rows", async () => {
    const { placer, shown } = createRecordingPlacer();

    renderWithPlacer(placer, createPanelProps(20));

    await waitFor(() => shown.length > 0);
    assert.deepEqual(shown.at(-1)?.spot, {
        row: 14,
        column: 2,
        columns: 16,
        rows: 8,
    });
});

test("KittyCoverView hides the cover once it is no longer shown", async () => {
    const { placer, shown, getHiddenCount } = createRecordingPlacer();
    const { rerenderPanel } = renderWithPlacer(placer, createPanelProps(36));
    await waitFor(() => shown.length > 0);

    rerenderPanel({ ...createPanelProps(36), cover: null });

    await waitFor(() => getHiddenCount() === 1);
});

test("KittyCoverView draws an empty box without a placer", () => {
    const { lastFrame } = render(
        createElement(MetadataPanel, createPanelProps(36))
    );

    assert.ok(!(lastFrame() ?? "").includes("▀"));
});
