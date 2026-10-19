import { Box, useWindowSize } from "ink";
import { useBrowser } from "../hooks/use-browser.js";
import { useEntryDetails } from "../hooks/use-entry-details.js";
import { useKeyboard } from "../hooks/use-keyboard.js";
import { useQuit } from "../hooks/use-quit.js";
import { useStore } from "../hooks/use-store.js";
import { getEntryStatus } from "../track-statuses.js";
import type { TrackStatusStore } from "../track-status-store.js";
import type { TuiServices } from "../tui-services.js";
import { BrowserPane, type BrowserPaneProps } from "./browser-pane.js";
import { LogPane } from "./log-pane.js";
import { MetadataPanel, type MetadataPanelProps } from "./metadata-panel.js";
import { StatusBar } from "./status-bar.js";

const LOG_LINES = 6;
// Log pane borders, status bar, browser borders, title and error line.
const RESERVED_ROWS = LOG_LINES + 2 + 1 + 2 + 2;
const MIN_LIST_HEIGHT = 3;

export interface AppProps {
    startDirectory: string;
    services: TuiServices;
}

function useLayout() {
    const { rows } = useWindowSize();
    return {
        rows,
        listHeight: Math.max(rows - RESERVED_ROWS, MIN_LIST_HEIGHT),
    };
}

function useBrowsing(startDirectory: string, statusStore: TrackStatusStore) {
    const statuses = useStore(statusStore);
    const [browser, dispatch] = useBrowser(startDirectory, statusStore);
    const hovered = browser.entries[browser.cursor];
    const status = hovered && getEntryStatus(statuses, hovered);
    const details = useEntryDetails(hovered, status);
    return { browser, dispatch, hovered, details, statuses };
}

function useAppState({ startDirectory, services }: AppProps) {
    const { queue, statusStore } = services;
    const layout = useLayout();
    const queueState = useStore(queue);
    const browsing = useBrowsing(startDirectory, statusStore);
    const { quitting, requestQuit } = useQuit(queue, queueState);
    useKeyboard({
        ...browsing,
        directory: browsing.browser.directory,
        queue,
        quitting,
        requestQuit,
        pageSize: layout.listHeight,
    });
    return { ...layout, ...browsing, queueState, quitting };
}

type WorkspaceProps = BrowserPaneProps & MetadataPanelProps;

function Workspace({
    state,
    entry,
    details,
    statuses,
    height,
}: WorkspaceProps) {
    return (
        <Box flexGrow={1}>
            <BrowserPane state={state} statuses={statuses} height={height} />
            <MetadataPanel
                entry={entry}
                details={details}
                statuses={statuses}
            />
        </Box>
    );
}

export function App(props: AppProps) {
    const state = useAppState(props);
    return (
        <Box flexDirection="column" height={state.rows}>
            <Workspace
                state={state.browser}
                entry={state.hovered}
                details={state.details}
                statuses={state.statuses}
                height={state.listHeight}
            />
            <LogPane logBuffer={props.services.logBuffer} height={LOG_LINES} />
            <StatusBar
                queueState={state.queueState}
                quitting={state.quitting}
            />
        </Box>
    );
}
