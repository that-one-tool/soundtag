import { Box, Text } from "ink";
import type { ReactNode } from "react";
import type { TrackStatus } from "../../processing/types.js";
import {
    formatBitrate,
    formatChannels,
    formatDisc,
    formatDuration,
    formatFileSize,
    formatPosition,
    formatSampleRate,
    joinKnown,
} from "../detail-format.js";
import { ERROR_COLOR, PANE_COLOR, STATUS_COLOR } from "../theme.js";
import { countFolderStatuses, STATUS_ORDER } from "../track-statuses.js";
import type { TrackExtras } from "../../metadata/types.js";
import type { TrackDetails } from "../../tags/types.js";
import type {
    BrowserEntry,
    CoverArt,
    EntryDetails,
    TrackStatuses,
} from "../types.js";
import { CoverArtView } from "./cover-art-view.js";

// Border and padding on both sides.
const PANEL_FRAME_COLUMNS = 4;
const MIN_COVER_SIZE = 16;
const LABEL_WIDTH = 13;

interface FieldRow {
    label: string;
    value: string | number;
    color?: string;
}

function Field({ label, value, color }: FieldRow) {
    const text = String(value);
    return (
        <Box flexShrink={0}>
            <Box width={LABEL_WIDTH} flexShrink={0}>
                <Text color={PANE_COLOR.metadata}>{label}</Text>
            </Box>
            <Text color={color} dimColor={!text} wrap="truncate">
                {text || "—"}
            </Text>
        </Box>
    );
}

function FieldList({ rows }: { rows: FieldRow[] }) {
    return rows.map((row) => <Field key={row.label} {...row} />);
}

interface DetailsViewProps<Kind extends EntryDetails["kind"]> {
    details: Extract<EntryDetails, { kind: Kind }>;
    entry: BrowserEntry;
    statuses: TrackStatuses;
    cover: CoverArt | null;
    detailRows: number;
    width: number;
}

type FileDetailsData = Extract<EntryDetails, { kind: "file" }>;

function formatTrackAndDisc(track: TrackDetails): string {
    return joinKnown([
        formatPosition(track.trackNumber, track.trackCount),
        formatDisc(track.discNumber, track.discCount),
    ]);
}

function formatAudio(track: TrackDetails): string {
    return joinKnown([
        formatBitrate(track.bitrateKbps),
        formatSampleRate(track.sampleRateHz),
        formatChannels(track.channels),
    ]);
}

function getAlbumArtistRows({ albumArtist }: TrackExtras): FieldRow[] {
    return albumArtist ? [{ label: "Album artist", value: albumArtist }] : [];
}

function getTagRows({ tags, track }: FileDetailsData): FieldRow[] {
    return [
        { label: "Title", value: tags.info.title },
        { label: "Artist", value: tags.info.artist },
        { label: "Album", value: tags.info.album },
        ...getAlbumArtistRows(tags.extras),
        { label: "Year", value: tags.info.year },
        { label: "Track", value: formatTrackAndDisc(track) },
        { label: "Genre", value: track.genre },
        { label: "Cover", value: tags.hasCover ? "yes" : "no" },
    ];
}

function getAudioRows({ track, format }: FileDetailsData): FieldRow[] {
    return [
        {
            label: "Duration",
            value: formatDuration(track.durationMilliseconds),
        },
        { label: "Audio", value: formatAudio(track) },
        {
            label: "File",
            value: joinKnown([format, formatFileSize(track.sizeBytes)]),
        },
    ];
}

function getStatusRow(status: TrackStatus | undefined): FieldRow {
    const color = status && STATUS_COLOR[status];
    return { label: "Status", value: status ?? "", color };
}

interface CoverSpace {
    freeRows: number;
    freeColumns: number;
}

function roundDownToEven(value: number): number {
    return value - (value % 2);
}

// Each row holds two pixels and one blank row sits above the cover.
function getCoverSize(cover: CoverArt, { freeRows, freeColumns }: CoverSpace) {
    const sizeByRows = (freeRows - 1) * 2;
    return roundDownToEven(Math.min(cover.height, sizeByRows, freeColumns));
}

function FittingCover({
    cover,
    space,
}: {
    cover: CoverArt;
    space: CoverSpace;
}) {
    const size = getCoverSize(cover, space);
    if (size < MIN_COVER_SIZE) {
        return null;
    }

    return (
        <Box marginTop={1}>
            <CoverArtView cover={cover} size={size} />
        </Box>
    );
}

function FileDetails(props: DetailsViewProps<"file">) {
    const { details, entry, statuses } = props;
    const rows = [
        getStatusRow(statuses.get(entry.path)),
        ...getTagRows(details),
        ...getAudioRows(details),
    ];
    const space = {
        freeRows: props.detailRows - rows.length,
        freeColumns: props.width - PANEL_FRAME_COLUMNS,
    };
    return (
        <>
            <FieldList rows={rows} />
            {props.cover && <FittingCover cover={props.cover} space={space} />}
        </>
    );
}

function formatStatusLabel(status: TrackStatus): string {
    return status.charAt(0) + status.slice(1).toLowerCase();
}

function getFolderRows(
    { audioFileCount, subfolderCount }: DetailsViewProps<"folder">["details"],
    counts: Record<TrackStatus, number>
): FieldRow[] {
    const statusRows = STATUS_ORDER.map((status) => ({
        label: formatStatusLabel(status),
        value: counts[status],
        color: STATUS_COLOR[status],
    }));
    return [
        { label: "Audio files", value: audioFileCount },
        { label: "Subfolders", value: subfolderCount },
        ...statusRows,
    ];
}

function FolderDetails({
    details,
    entry,
    statuses,
}: DetailsViewProps<"folder">) {
    const counts = countFolderStatuses(statuses, entry.path);
    return <FieldList rows={getFolderRows(details, counts)} />;
}

function UnreadableDetails({ details }: DetailsViewProps<"unreadable">) {
    return <Text color={ERROR_COLOR}>Cannot read: {details.message}</Text>;
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

function renderDetails({
    details,
    entry,
    ...rest
}: MetadataPanelProps): ReactNode {
    if (!details || !entry) {
        return <Text dimColor>Loading…</Text>;
    }

    const View = DETAIL_VIEWS[details.kind] as (
        props: DetailsViewProps<EntryDetails["kind"]>
    ) => ReactNode;
    return <View {...rest} details={details} entry={entry} />;
}

export interface MetadataPanelProps {
    entry: BrowserEntry | undefined;
    details: EntryDetails | null;
    loading: boolean;
    statuses: TrackStatuses;
    cover: CoverArt | null;
    detailRows: number;
    width: number;
}

function PanelHeader({ loading }: { loading: boolean }) {
    return (
        <Box flexShrink={0}>
            <Text bold color={PANE_COLOR.metadata}>
                Metadata
            </Text>
            {loading && <Text dimColor> …</Text>}
        </Box>
    );
}

export function MetadataPanel(props: MetadataPanelProps) {
    return (
        <Box
            flexDirection="column"
            width={props.width}
            flexShrink={0}
            borderStyle="round"
            borderColor={PANE_COLOR.metadata}
            paddingX={1}
            overflow="hidden"
        >
            <PanelHeader loading={props.loading} />
            {renderDetails(props)}
        </Box>
    );
}
