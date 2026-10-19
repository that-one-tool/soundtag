import assert from "node:assert/strict";
import { test } from "node:test";
import {
    formatBitrate,
    formatChannels,
    formatDisc,
    formatDuration,
    formatFileSize,
    formatPosition,
    formatSampleRate,
    joinKnown,
} from "../../src/tui/detail-format.js";

test("formatPosition shows the number and the total when known", () => {
    assert.equal(formatPosition(3, 12), "3/12");
    assert.equal(formatPosition(3, 0), "3");
    assert.equal(formatPosition(0, 12), "");
});

test("formatDuration shows minutes and padded seconds", () => {
    assert.equal(formatDuration(225_400), "3:45");
    assert.equal(formatDuration(65_000), "1:05");
    assert.equal(formatDuration(3_725_000), "62:05");
    assert.equal(formatDuration(0), "");
});

test("formatBitrate rounds to whole kilobits", () => {
    assert.equal(formatBitrate(319.6), "320 kbps");
    assert.equal(formatBitrate(0), "");
});

test("formatSampleRate shows kilohertz", () => {
    assert.equal(formatSampleRate(44_100), "44.1 kHz");
    assert.equal(formatSampleRate(8000), "8 kHz");
    assert.equal(formatSampleRate(0), "");
});

test("formatChannels names mono and stereo", () => {
    assert.equal(formatChannels(1), "mono");
    assert.equal(formatChannels(2), "stereo");
    assert.equal(formatChannels(6), "6 channels");
    assert.equal(formatChannels(0), "");
});

test("formatFileSize uses kilobytes below one megabyte", () => {
    assert.equal(formatFileSize(4_404_019), "4.2 MB");
    assert.equal(formatFileSize(2048), "2 KB");
    assert.equal(formatFileSize(0), "0 KB");
});

test("formatDisc names the disc position when known", () => {
    assert.equal(formatDisc(1, 2), "disc 1/2");
    assert.equal(formatDisc(0, 2), "");
});

test("joinKnown joins the known parts with a dot", () => {
    assert.equal(joinKnown(["320 kbps", "", "stereo"]), "320 kbps · stereo");
    assert.equal(joinKnown(["", ""]), "");
});
