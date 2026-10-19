import assert from "node:assert/strict";
import { test } from "node:test";
import type {
    CommandLineOptions,
    FileStatus,
    ProcessingReport,
    ProcessingStats,
    TrackInfo,
    TrackMetadata,
} from "../src/types.js";

test("shared types describe the processing and track data shapes", () => {
    const options: CommandLineOptions = {
        sourcePath: "./music",
        recursive: false,
        verbose: false,
    };
    const status: FileStatus = "TAGGED";
    const stats: ProcessingStats = { ok: 1, skipped: 2, errors: 0 };
    const report: ProcessingReport = { files: { "song.mp3": status } };
    const info: TrackInfo = {
        title: "Title",
        artist: "Artist",
        album: "Album",
        year: "2024",
    };
    const metadata: TrackMetadata = { info, coverData: null };

    assert.equal(options.recursive, false);
    assert.equal(options.verbose, false);
    assert.equal(report.files["song.mp3"], "TAGGED");
    assert.equal(stats.ok, 1);
    assert.equal(metadata.info.title, "Title");
    assert.equal(metadata.info.year, "2024");
});
