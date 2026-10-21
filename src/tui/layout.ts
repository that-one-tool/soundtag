const MIN_LOG_LINES = 6;
const LOG_SHARE = 3;
const LOG_BORDER_ROWS = 2;
// Header, log pane borders, status bar, browser borders, title and error line.
const FIXED_ROWS = 1 + LOG_BORDER_ROWS + 1 + 2 + 2;
const MIN_LIST_HEIGHT = 3;

export interface Layout {
    logLines: number;
    listHeight: number;
    detailRows: number;
}

// The metadata pane is as tall as the browser, whose title and error line
// match its header plus one row.
const DETAIL_ROWS_BEYOND_LIST = 1;

function getLogLines(rows: number): number {
    const logPaneRows = Math.floor(rows / LOG_SHARE);
    return Math.max(logPaneRows - LOG_BORDER_ROWS, MIN_LOG_LINES);
}

export function getLayout(rows: number): Layout {
    const logLines = getLogLines(rows);
    const listHeight = Math.max(rows - FIXED_ROWS - logLines, MIN_LIST_HEIGHT);
    const detailRows = listHeight + DETAIL_ROWS_BEYOND_LIST;
    return { logLines, listHeight, detailRows };
}

// Wide enough for the 48-column cover inside the border and padding.
const FULL_PANEL_WIDTH = 52;

export function getPanelWidth(columns: number): number {
    return Math.min(FULL_PANEL_WIDTH, Math.floor(columns / 2));
}

// Browser border, padding, cursor marker, status dot and the space after it.
const BROWSER_ROW_FRAME_COLUMNS = 8;

export function getNameWidth(columns: number): number {
    return columns - getPanelWidth(columns) - BROWSER_ROW_FRAME_COLUMNS;
}

// The log pane's round border and one column of padding on each side.
const LOG_FRAME_COLUMNS = 4;

export function getLogWidth(columns: number): number {
    return columns - LOG_FRAME_COLUMNS;
}
