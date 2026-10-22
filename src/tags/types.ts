import type {
    ExistingTags,
    TrackExtras,
    TrackMetadata,
} from "../metadata/types.js";

export type StoredTags = ExistingTags;

export interface TagWrite extends TrackMetadata {
    clearedExtras?: readonly (keyof TrackExtras)[];
}

export interface TagStore {
    read(source: string): Promise<StoredTags>;
    readCover(source: string): Promise<Buffer | null>;
    write(source: string, metadata: TagWrite): Promise<void>;
}

export interface TrackDetails {
    trackNumber: number;
    trackCount: number;
    discNumber: number;
    discCount: number;
    genre: string;
    durationMilliseconds: number;
    bitrateKbps: number;
    sampleRateHz: number;
    channels: number;
    sizeBytes: number;
}
