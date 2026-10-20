import { Box, Text, type TextProps } from "ink";
import type { BrowserState } from "../browser-state.js";
import { getVisibleRange } from "../list-window.js";
import { getFieldWindow } from "../name-field.js";
import type { RenameDraft } from "../rename-draft.js";
import { getEntryDot } from "../entry-dot.js";
import {
    ACCENT,
    ERROR_COLOR,
    FOLDER_COLOR,
    PANE_COLOR,
    SELECTION_MARKER,
    SELECTION_TEXT,
} from "../theme.js";
import type { BrowserEntry, DotSources, EntryKind } from "../types.js";
import { StatusDot } from "./status-dot.js";

interface EntryRowProps {
    entry: BrowserEntry;
    dotSources: DotSources;
    hovered: boolean;
    draft: RenameDraft | null;
    nameWidth: number;
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

function DraftField({ draft, width }: { draft: RenameDraft; width: number }) {
    const fieldWidth = Math.max(1, width - draft.extension.length);
    const { beforeCaret, atCaret, afterCaret } = getFieldWindow(
        draft.field,
        fieldWidth
    );
    return (
        <Text wrap="truncate">
            {beforeCaret}
            <Text inverse>{atCaret}</Text>
            {afterCaret}
            <Text dimColor>{draft.extension}</Text>
        </Text>
    );
}

// The field follows its own entry, wherever the cursor is.
function EntryLabel({ entry, hovered, draft, nameWidth }: EntryRowProps) {
    if (draft?.entry.path === entry.path) {
        return <DraftField draft={draft} width={nameWidth} />;
    }

    return (
        <Text {...getEntryStyle(entry, hovered)} wrap="truncate">
            {getEntryLabel(entry)}
        </Text>
    );
}

function EntryRow(props: EntryRowProps) {
    const { entry, dotSources, hovered } = props;
    return (
        <Box>
            <Text color={ACCENT}>
                {hovered ? `${SELECTION_MARKER} ` : "  "}
            </Text>
            <StatusDot dot={getEntryDot(dotSources, entry)} />
            <Text> </Text>
            <EntryLabel {...props} />
        </Box>
    );
}

export interface BrowserPaneProps {
    state: BrowserState;
    dotSources: DotSources;
    height: number;
    focused: boolean;
    draft: RenameDraft | null;
    nameWidth: number;
}

function EntryList(props: BrowserPaneProps) {
    const { state, dotSources, height, draft, nameWidth } = props;
    const { entries, cursor } = state;
    const { start, end } = getVisibleRange(entries.length, cursor, height);
    return entries
        .slice(start, end)
        .map((entry, index) => (
            <EntryRow
                key={entry.path}
                entry={entry}
                dotSources={dotSources}
                hovered={start + index === cursor}
                draft={draft}
                nameWidth={nameWidth}
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
            borderDimColor={!props.focused}
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
