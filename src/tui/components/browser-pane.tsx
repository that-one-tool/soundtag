import { Box, Text } from "ink";
import type { BrowserState } from "../browser-state.js";
import { getVisibleRange } from "../list-window.js";
import { getEntryStatus } from "../track-statuses.js";
import type { BrowserEntry, TrackStatuses } from "../types.js";
import { StatusDot } from "./status-dot.js";

interface EntryRowProps {
    entry: BrowserEntry;
    statuses: TrackStatuses;
    hovered: boolean;
}

function getEntryLabel({ name, kind }: BrowserEntry): string {
    return kind === "folder" ? `${name}/` : name;
}

function EntryRow({ entry, statuses, hovered }: EntryRowProps) {
    return (
        <Box>
            <Text color="cyan">{hovered ? "› " : "  "}</Text>
            <StatusDot status={getEntryStatus(statuses, entry)} />
            <Text inverse={hovered} wrap="truncate">
                {` ${getEntryLabel(entry)}`}
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
        <Text color="red" wrap="truncate">
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
            paddingX={1}
        >
            <Text bold wrap="truncate-start">
                {directory}
            </Text>
            <ListingError error={error} />
            <EntryList {...props} />
        </Box>
    );
}
