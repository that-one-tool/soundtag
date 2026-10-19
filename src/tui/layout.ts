const MIN_LOG_LINES = 6;
const LOG_SHARE = 3;
const LOG_BORDER_ROWS = 2;
// Header, log pane borders, status bar, browser borders, title and error line.
const FIXED_ROWS = 1 + LOG_BORDER_ROWS + 1 + 2 + 2;
const MIN_LIST_HEIGHT = 3;

export interface Layout {
    logLines: number;
    listHeight: number;
}

function getLogLines(rows: number): number {
    const logPaneRows = Math.floor(rows / LOG_SHARE);
    return Math.max(logPaneRows - LOG_BORDER_ROWS, MIN_LOG_LINES);
}

export function getLayout(rows: number): Layout {
    const logLines = getLogLines(rows);
    const listHeight = rows - FIXED_ROWS - logLines;
    return { logLines, listHeight: Math.max(listHeight, MIN_LIST_HEIGHT) };
}
