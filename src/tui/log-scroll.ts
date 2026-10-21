import type { LogLine } from "./log-buffer.js";

export interface LogWindow {
    lines: readonly LogLine[];
    hiddenBelow: number;
}

export interface LogSize {
    height: number;
    width: number;
}

export interface LogAnchor extends LogSize {
    anchorId: number | null;
}

export interface LogScroll {
    anchorId: number | null;
    delta: number;
}

function clampEnd(end: number, lines: readonly LogLine[], height: number) {
    return Math.min(Math.max(end, height), lines.length);
}

// The anchor is the bottom visible line; without one the view follows the
// latest lines. A replaced anchor row (progress) keeps the view at the row
// before it; an anchor dropped from the buffer leaves the oldest lines.
function getWindowEnd(
    lines: readonly LogLine[],
    height: number,
    anchorId: number | null
): number {
    if (anchorId === null) {
        return lines.length;
    }

    const anchorIndex = lines.findLastIndex((line) => line.id <= anchorId);
    return clampEnd(anchorIndex + 1, lines, height);
}

function getVisibleLines(lines: readonly LogLine[], height: number) {
    const visible = lines.slice(-height);

    if (visible[0]?.text !== "") {
        return visible;
    }

    return [...lines.slice(-height - 1, -height), ...visible.slice(1)];
}

export function getLogWindow(
    lines: readonly LogLine[],
    height: number,
    anchorId: number | null
): LogWindow {
    const end = getWindowEnd(lines, height, anchorId);
    return {
        lines: getVisibleLines(lines.slice(0, end), height),
        hiddenBelow: lines.length - end,
    };
}

export function scrollLog(
    lines: readonly LogLine[],
    height: number,
    { anchorId, delta }: LogScroll
): number | null {
    const current = getWindowEnd(lines, height, anchorId);
    const end = clampEnd(current + delta, lines, height);
    return end < lines.length ? lines[end - 1].id : null;
}

// Lines set for another pane size would no longer be the bottom one.
export function getActiveAnchor(
    { anchorId, height, width }: LogAnchor,
    current: LogSize
): number | null {
    const isSameSize = height === current.height && width === current.width;
    return isSameSize ? anchorId : null;
}
