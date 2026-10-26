import { TRACK_FIELDS } from "../metadata/track-metadata.js";
import type {
    TrackExtras,
    TrackInfo,
    TrackMetadata,
    TrackSearch,
} from "../metadata/types.js";
import type { TagWrite } from "../tags/types.js";
import { formatLogLine } from "../shared/lookup-log.js";

export interface WrittenTrack {
    existing: TrackInfo;
    metadata: TagWrite;
    missing: string[];
}

type ValueReader = (metadata: TrackMetadata) => string | number | undefined;

const SEPARATOR = " · ";
const EMPTY_TAG = "–";

const WRITTEN_EXTRAS: [string, ValueReader][] = [
    ["genre", ({ extras }) => extras.genre && `"${extras.genre}"`],
    [
        "album artist",
        ({ extras }) => extras.albumArtist && `"${extras.albumArtist}"`,
    ],
    ["track", ({ extras }) => extras.trackNumber],
    ["disc", ({ extras }) => extras.discNumber],
];

export function formatTagsLine(info: TrackInfo): string {
    const tags = TRACK_FIELDS.map((field) => info[field].trim() || EMPTY_TAG);
    return formatLogLine("tags", tags.join(SEPARATOR));
}

export function formatSearchSubject({ title, artist, album }: TrackSearch) {
    const terms = [title && `"${title}"`, artist, album];
    return terms.filter(Boolean).join(SEPARATOR);
}

export function formatSkipLine(reason: string): string {
    return formatLogLine("skip", reason);
}

function describeNewInfo({ existing, metadata }: WrittenTrack): string[] {
    const added = TRACK_FIELDS.filter(
        (field) => !existing[field].trim() && metadata.info[field].trim()
    );
    return added.map((field) => `${field} "${metadata.info[field]}"`);
}

function describeNewExtras({ metadata }: WrittenTrack): string[] {
    return WRITTEN_EXTRAS.flatMap(([name, read]) => {
        const value = read(metadata);
        return value ? [`${name} ${value}`] : [];
    });
}

const EXTRA_NAMES: Record<keyof TrackExtras, string> = {
    genre: "genre",
    albumArtist: "album artist",
    trackNumber: "track",
    trackCount: "track count",
    discNumber: "disc",
    discCount: "disc count",
};

function describeCleared({ metadata }: WrittenTrack): string[] {
    const names = (metadata.clearedExtras ?? []).map(
        (field) => EXTRA_NAMES[field]
    );
    return names.length > 0 ? [`cleared ${names.join(", ")}`] : [];
}

function describeMissing(missing: string[]): string {
    return missing.length > 0 ? ` (missing: ${missing.join(", ")})` : "";
}

export function formatWriteLine(written: WrittenTrack): string {
    const cover = written.metadata.coverData ? ["cover"] : [];
    const fields = [
        ...describeNewInfo(written),
        ...describeNewExtras(written),
        ...cover,
        ...describeCleared(written),
    ];
    const text = fields.join(SEPARATOR);
    return formatLogLine("write", `${text}${describeMissing(written.missing)}`);
}
