import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { countFolderStatuses } from "../track-statuses.js";
import type { BrowserEntry, EntryDetails, TrackStatuses } from "../types.js";

const PANEL_WIDTH = 36;
const LABEL_WIDTH = 13;

function Field({ label, value }: { label: string; value: string | number }) {
    return (
        <Box>
            <Box width={LABEL_WIDTH} flexShrink={0}>
                <Text dimColor>{label}</Text>
            </Box>
            <Text wrap="truncate">{String(value) || "—"}</Text>
        </Box>
    );
}

interface DetailsViewProps<Kind extends EntryDetails["kind"]> {
    details: Extract<EntryDetails, { kind: Kind }>;
    entry: BrowserEntry;
    statuses: TrackStatuses;
}

function FileDetails({ details, entry, statuses }: DetailsViewProps<"file">) {
    const { info, hasCover } = details.tags;
    return (
        <>
            <Field label="Title" value={info.title} />
            <Field label="Artist" value={info.artist} />
            <Field label="Album" value={info.album} />
            <Field label="Year" value={info.year} />
            <Field label="Cover" value={hasCover ? "yes" : "no"} />
            <Field label="Format" value={details.format} />
            <Field label="Status" value={statuses.get(entry.path) ?? ""} />
        </>
    );
}

function FolderDetails({
    details,
    entry,
    statuses,
}: DetailsViewProps<"folder">) {
    const counts = countFolderStatuses(statuses, entry.path);
    return (
        <>
            <Field label="Audio files" value={details.audioFileCount} />
            <Field label="Subfolders" value={details.subfolderCount} />
            <Field label="Tagged" value={counts.TAGGED} />
            <Field label="Skipped" value={counts.SKIPPED} />
            <Field label="Failed" value={counts.FAILED} />
        </>
    );
}

function UnreadableDetails({ details }: DetailsViewProps<"unreadable">) {
    return <Text color="red">Cannot read: {details.message}</Text>;
}

function ParentDetails() {
    return <Text dimColor>Parent folder</Text>;
}

const DETAIL_VIEWS: {
    [Kind in EntryDetails["kind"]]: (
        props: DetailsViewProps<Kind>
    ) => ReactNode;
} = {
    file: FileDetails,
    folder: FolderDetails,
    unreadable: UnreadableDetails,
    parent: ParentDetails,
};

function renderDetails(
    details: EntryDetails | null,
    entry: BrowserEntry | undefined,
    statuses: TrackStatuses
): ReactNode {
    if (!details || !entry) {
        return <Text dimColor>Loading…</Text>;
    }

    const View = DETAIL_VIEWS[details.kind] as (
        props: DetailsViewProps<EntryDetails["kind"]>
    ) => ReactNode;
    return <View details={details} entry={entry} statuses={statuses} />;
}

export interface MetadataPanelProps {
    entry: BrowserEntry | undefined;
    details: EntryDetails | null;
    statuses: TrackStatuses;
}

export function MetadataPanel({
    entry,
    details,
    statuses,
}: MetadataPanelProps) {
    return (
        <Box
            flexDirection="column"
            width={PANEL_WIDTH}
            borderStyle="round"
            paddingX={1}
        >
            <Text bold>Metadata</Text>
            {renderDetails(details, entry, statuses)}
        </Box>
    );
}
