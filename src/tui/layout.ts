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

// The 48-pixel cover takes 24 rows; its columns follow the cell shape.
const FULL_COVER_ROWS = 24;
// Border and padding on both sides.
export const PANEL_FRAME_COLUMNS = 4;
// Room for the fields when cells are wider than half their height.
const MIN_FULL_PANEL_WIDTH = 52;

function getFullPanelWidth(cellRatio: number): number {
    const coverColumns = Math.ceil(FULL_COVER_ROWS * cellRatio);
    return Math.max(MIN_FULL_PANEL_WIDTH, coverColumns + PANEL_FRAME_COLUMNS);
}

export function getPanelWidth(columns: number, cellRatio: number): number {
    return Math.min(getFullPanelWidth(cellRatio), Math.floor(columns / 2));
}

// Browser border, padding, cursor marker, status dot and the space after it.
const BROWSER_ROW_FRAME_COLUMNS = 8;

export function getNameWidth(columns: number, cellRatio: number): number {
    const panelWidth = getPanelWidth(columns, cellRatio);
    return columns - panelWidth - BROWSER_ROW_FRAME_COLUMNS;
}

// The log pane's round border and one column of padding on each side.
const LOG_FRAME_COLUMNS = 4;

export function getLogWidth(columns: number): number {
    return columns - LOG_FRAME_COLUMNS;
}
