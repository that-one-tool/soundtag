import { Box, useWindowSize } from "ink";
import { useBrowser } from "../hooks/use-browser.js";
import { useEntryValue } from "../hooks/use-entry-value.js";
import { useKeyboard } from "../hooks/use-keyboard.js";
import { useLogView } from "../hooks/use-log-view.js";
import { useQuit } from "../hooks/use-quit.js";
import { useRename } from "../hooks/use-rename.js";
import { useStore } from "../hooks/use-store.js";
import {
    getLayout,
    getLogWidth,
    getNameWidth,
    getPanelWidth,
} from "../layout.js";
import { getEntryStatus } from "../track-statuses.js";
import type { TuiServices } from "../tui-services.js";
import { getShownCover } from "../shown-cover.js";
import { BrowserPane, type BrowserPaneProps } from "./browser-pane.js";
import { Header } from "./header.js";
import { CoverPlacerContext } from "./kitty-cover-view.js";
import { LogPane, type LogPaneProps } from "./log-pane.js";
import { MetadataPanel, type MetadataPanelProps } from "./metadata-panel.js";
import { StatusBar } from "./status-bar.js";

export interface AppProps {
    startDirectory: string;
    services: TuiServices;
}

function useLayout() {
    const { rows, columns } = useWindowSize();
    const layout = getLayout(rows);
    return {
        rows,
        ...layout,
        panelWidth: getPanelWidth(columns),
        nameWidth: getNameWidth(columns),
        logSize: { height: layout.logLines, width: getLogWidth(columns) },
    };
}

function useBrowsing(startDirectory: string, services: TuiServices) {
    const statuses = useStore(services.statusStore);
    const redoneFiles = useStore(services.redoneFiles);
    const revision = useStore(services.tagClearer);
    const [browser, dispatch] = useBrowser(startDirectory, {
        changes: services.statusStore,
        moves: services.pathMoves,
    });
    const hovered = browser.entries[browser.cursor];
    const request = {
        entry: hovered,
        status: hovered && getEntryStatus(statuses, hovered),
        revision,
    };
    const view = useEntryValue(request, services.detailsCache);
    const coverView = useEntryValue(request, services.coverCache);
    const cover = getShownCover(view.entry, coverView);
    const details = { ...view, details: view.value, cover };
    return { browser, dispatch, hovered, details, statuses, redoneFiles };
}

function useSettingChoices(services: TuiServices) {
    return {
        subfoldersIncluded: useStore(services.subfolders),
        renamingEnabled: useStore(services.renaming),
        fixingEnabled: useStore(services.fixing),
        overwritingEnabled: useStore(services.overwriting),
    };
}

function useStatus(services: TuiServices) {
    const { queue, coverOverlay } = services;
    const queueState = useStore(queue);
    const choices = useSettingChoices(services);
    const { quitting, requestQuit } = useQuit(queue, queueState, coverOverlay);
    return {
        status: { queueState, quitting, ...choices },
        requestQuit,
    };
}

function useAppState({ startDirectory, services }: AppProps) {
    const layout = useLayout();
    const browsing = useBrowsing(startDirectory, services);
    const { status, requestQuit } = useStatus(services);
    const logView = useLogView(services.logBuffer, layout.logSize);
    const rename = useRename(services.renamer);
    useKeyboard({
        ...services,
        ...browsing,
        directory: browsing.browser.directory,
        quitting: status.quitting,
        requestQuit,
        pageSize: layout.listHeight,
        logView,
        logPageSize: layout.logLines,
        rename,
    });
    return { ...layout, ...browsing, status, logView, services, rename };
}

function getLogPaneProps({
    services,
    logSize,
    logView,
}: ReturnType<typeof useAppState>): LogPaneProps {
    return {
        logBuffer: services.logBuffer,
        ...logSize,
        anchorId: logView.anchorId,
        focused: logView.focus === "log",
    };
}

interface WorkspaceProps {
    browser: BrowserPaneProps;
    details: MetadataPanelProps;
}

function Workspace({ browser, details }: WorkspaceProps) {
    return (
        <Box flexGrow={1} overflow="hidden">
            <BrowserPane {...browser} />
            <MetadataPanel {...details} />
        </Box>
    );
}

function getBrowserPaneProps(
    state: ReturnType<typeof useAppState>
): BrowserPaneProps {
    return {
        state: state.browser,
        dotSources: {
            queue: state.status.queueState,
            statuses: state.statuses,
            redoneFiles: state.redoneFiles,
        },
        height: state.listHeight,
        focused: state.logView.focus === "browser",
        draft: state.rename.draft,
        nameWidth: state.nameWidth,
    };
}

function getMetadataPanelProps(
    state: ReturnType<typeof useAppState>
): MetadataPanelProps {
    return {
        ...state.details,
        statuses: state.statuses,
        detailRows: state.detailRows,
        width: state.panelWidth,
    };
}

export function App(props: AppProps) {
    const state = useAppState(props);
    return (
        <CoverPlacerContext.Provider value={state.services.coverOverlay}>
            <Box flexDirection="column" height={state.rows}>
                <Header statuses={state.statuses} />
                <Workspace
                    browser={getBrowserPaneProps(state)}
                    details={getMetadataPanelProps(state)}
                />
                <LogPane {...getLogPaneProps(state)} />
                <StatusBar {...state.status} />
            </Box>
        </CoverPlacerContext.Provider>
    );
}
