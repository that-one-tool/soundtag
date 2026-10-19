import { Box, useWindowSize } from "ink";
import { useBrowser } from "../hooks/use-browser.js";
import { useEntryDetails } from "../hooks/use-entry-details.js";
import { useKeyboard } from "../hooks/use-keyboard.js";
import { useQuit } from "../hooks/use-quit.js";
import { useStore } from "../hooks/use-store.js";
import { getLayout } from "../layout.js";
import { getEntryStatus } from "../track-statuses.js";
import type { TuiServices } from "../tui-services.js";
import { BrowserPane, type BrowserPaneProps } from "./browser-pane.js";
import { Header } from "./header.js";
import { LogPane } from "./log-pane.js";
import { MetadataPanel, type MetadataPanelProps } from "./metadata-panel.js";
import { StatusBar } from "./status-bar.js";

export interface AppProps {
    startDirectory: string;
    services: TuiServices;
}

function useLayout() {
    const { rows } = useWindowSize();
    return { rows, ...getLayout(rows) };
}

function useBrowsing(
    startDirectory: string,
    { statusStore, ...sources }: TuiServices
) {
    const statuses = useStore(statusStore);
    const [browser, dispatch] = useBrowser(startDirectory, statusStore);
    const hovered = browser.entries[browser.cursor];
    const status = hovered && getEntryStatus(statuses, hovered);
    const details = useEntryDetails({ entry: hovered, status }, sources);
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
    useKeyboard({
        ...browsing,
        directory: browsing.browser.directory,
        queue: services.queue,
        quitting: status.quitting,
        requestQuit,
        pageSize: layout.listHeight,
        subfolders: services.subfolders,
    });
    return { ...layout, ...browsing, status, logBuffer: services.logBuffer };
}

type WorkspaceProps = BrowserPaneProps & MetadataPanelProps;

function Workspace({ state, statuses, height, ...details }: WorkspaceProps) {
    return (
        <Box flexGrow={1} overflow="hidden">
            <BrowserPane state={state} statuses={statuses} height={height} />
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
            />
            <LogPane logBuffer={state.logBuffer} height={state.logLines} />
            <StatusBar {...state.status} />
        </Box>
    );
}
