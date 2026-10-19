import { Box, useWindowSize } from "ink";
import { useBrowser } from "../hooks/use-browser.js";
import { useEntryValue } from "../hooks/use-entry-value.js";
import { useKeyboard } from "../hooks/use-keyboard.js";
import { useLogView } from "../hooks/use-log-view.js";
import { useQuit } from "../hooks/use-quit.js";
import { useStore } from "../hooks/use-store.js";
import { getLayout, getPanelWidth } from "../layout.js";
import { getEntryStatus } from "../track-statuses.js";
import type { TuiServices } from "../tui-services.js";
import { getShownCover } from "../shown-cover.js";
import { BrowserPane, type BrowserPaneProps } from "./browser-pane.js";
import { Header } from "./header.js";
import { LogPane, type LogPaneProps } from "./log-pane.js";
import { MetadataPanel, type MetadataPanelProps } from "./metadata-panel.js";
import { StatusBar } from "./status-bar.js";

export interface AppProps {
    startDirectory: string;
    services: TuiServices;
}

function useLayout() {
    const { rows, columns } = useWindowSize();
    return { rows, ...getLayout(rows), panelWidth: getPanelWidth(columns) };
}

function useBrowsing(startDirectory: string, services: TuiServices) {
    const statuses = useStore(services.statusStore);
    const [browser, dispatch] = useBrowser(startDirectory, {
        changes: services.statusStore,
        moves: services.pathMoves,
    });
    const hovered = browser.entries[browser.cursor];
    const request = {
        entry: hovered,
        status: hovered && getEntryStatus(statuses, hovered),
    };
    const view = useEntryValue(request, services.detailsCache);
    const coverView = useEntryValue(request, services.coverCache);
    const cover = getShownCover(view.entry, coverView);
    const details = { ...view, details: view.value, cover };
    return { browser, dispatch, hovered, details, statuses };
}

function useStatus({ queue, subfolders }: TuiServices) {
    const queueState = useStore(queue);
    const subfoldersIncluded = useStore(subfolders);
    const { quitting, requestQuit } = useQuit(queue, queueState);
    return {
        status: { queueState, quitting, subfoldersIncluded },
        requestQuit,
    };
}

function useAppState({ startDirectory, services }: AppProps) {
    const layout = useLayout();
    const browsing = useBrowsing(startDirectory, services);
    const { status, requestQuit } = useStatus(services);
    const logView = useLogView(services.logBuffer, layout.logLines);
    useKeyboard({
        ...browsing,
        directory: browsing.browser.directory,
        queue: services.queue,
        quitting: status.quitting,
        requestQuit,
        pageSize: layout.listHeight,
        subfolders: services.subfolders,
        logView,
        logPageSize: layout.logLines,
    });
    return { ...layout, ...browsing, status, logView, services };
}

function getLogPaneProps({
    services,
    logLines,
    logView,
}: ReturnType<typeof useAppState>): LogPaneProps {
    return {
        logBuffer: services.logBuffer,
        height: logLines,
        anchorId: logView.anchorId,
        focused: logView.focus === "log",
    };
}

type WorkspaceProps = BrowserPaneProps & MetadataPanelProps;

function Workspace({
    state,
    statuses,
    height,
    focused,
    ...details
}: WorkspaceProps) {
    const browser = { state, statuses, height, focused };
    return (
        <Box flexGrow={1} overflow="hidden">
            <BrowserPane {...browser} />
            <MetadataPanel {...details} statuses={statuses} />
        </Box>
    );
}

export function App(props: AppProps) {
    const state = useAppState(props);
    return (
        <Box flexDirection="column" height={state.rows}>
            <Header statuses={state.statuses} />
            <Workspace
                state={state.browser}
                {...state.details}
                statuses={state.statuses}
                height={state.listHeight}
                detailRows={state.detailRows}
                width={state.panelWidth}
                focused={state.logView.focus === "browser"}
            />
            <LogPane {...getLogPaneProps(state)} />
            <StatusBar {...state.status} />
        </Box>
    );
}
