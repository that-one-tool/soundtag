import type { LogLine } from "./log-buffer.js";

// Lines up continuation rows with the text after a step label ("  search ").
const CONTINUATION = " ".repeat(9);
const MIN_WIDTH = CONTINUATION.length + 10;
// Continuation rows get ids between their line's and the next line's.
const ROWS_PER_LINE = 1000;

function getCut(text: string, width: number): number {
    const space = text.lastIndexOf(" ", width);
    return space > CONTINUATION.length ? space : width;
}

function wrapText(text: string, width: number): string[] {
    const rows: string[] = [];
    let rest = text;

    while (rest.length > width) {
        const cut = getCut(rest, width);
        rows.push(rest.slice(0, cut));
        rest = CONTINUATION + rest.slice(cut).trimStart();
    }

    return [...rows, rest];
}

export function wrapLogLines(
    lines: readonly LogLine[],
    width: number
): LogLine[] {
    if (width < MIN_WIDTH) {
        return [...lines];
    }

    return lines.flatMap((line) =>
        wrapText(line.text, width).map((text, part) => ({
            ...line,
            id: line.id + part / ROWS_PER_LINE,
            text,
        }))
    );
}
