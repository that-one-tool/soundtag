import { Box, Text, type TextProps } from "ink";
import type { BrowserState } from "../browser-state.js";
import { getVisibleRange } from "../list-window.js";
import { getEntryStatus } from "../track-statuses.js";
import {
    ACCENT,
    ERROR_COLOR,
    FOLDER_COLOR,
    PANE_COLOR,
    SELECTION_MARKER,
    SELECTION_TEXT,
} from "../theme.js";
import type { BrowserEntry, EntryKind, TrackStatuses } from "../types.js";
import { StatusDot } from "./status-dot.js";

interface EntryRowProps {
    entry: BrowserEntry;
    statuses: TrackStatuses;
    hovered: boolean;
}

const ENTRY_COLORS: Record<EntryKind, string | undefined> = {
    parent: FOLDER_COLOR,
    folder: FOLDER_COLOR,
    file: undefined,
};

const HOVERED_STYLE: TextProps = {
    backgroundColor: ACCENT,
    color: SELECTION_TEXT,
};

function getEntryLabel({ name, kind }: BrowserEntry): string {
    return kind === "folder" ? `${name}/` : name;
}

function getEntryStyle(entry: BrowserEntry, hovered: boolean): TextProps {
    return hovered ? HOVERED_STYLE : { color: ENTRY_COLORS[entry.kind] };
}

function EntryRow({ entry, statuses, hovered }: EntryRowProps) {
    return (
        <Box>
            <Text color={ACCENT}>
                {hovered ? `${SELECTION_MARKER} ` : "  "}
            </Text>
            <StatusDot status={getEntryStatus(statuses, entry)} />
            <Text> </Text>
            <Text {...getEntryStyle(entry, hovered)} wrap="truncate">
                {getEntryLabel(entry)}
            </Text>
        </Box>
    );
}

export interface BrowserPaneProps {
    state: BrowserState;
    statuses: TrackStatuses;
    height: number;
}

function EntryList({ state, statuses, height }: BrowserPaneProps) {
    const { entries, cursor } = state;
    const { start, end } = getVisibleRange(entries.length, cursor, height);
    return entries
        .slice(start, end)
        .map((entry, index) => (
            <EntryRow
                key={entry.path}
                entry={entry}
                statuses={statuses}
                hovered={start + index === cursor}
            />
        ));
}

function ListingError({ error }: { error: string | undefined }) {
    if (!error) {
        return null;
    }

    return (
        <Text color={ERROR_COLOR} wrap="truncate">
            {error}
        </Text>
    );
}

export function BrowserPane(props: BrowserPaneProps) {
    const { directory, error } = props.state;
    return (
        <Box
            flexDirection="column"
            flexGrow={1}
            borderStyle="round"
            borderColor={PANE_COLOR.browser}
            paddingX={1}
        >
            <Text bold color={PANE_COLOR.browser} wrap="truncate-start">
                {directory}
            </Text>
            <ListingError error={error} />
            <EntryList {...props} />
        </Box>
    );
}
