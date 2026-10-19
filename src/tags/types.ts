import type { ExistingTags, TrackMetadata } from "../metadata/types.js";

export type StoredTags = ExistingTags;

export interface TagStore {
    read(source: string): Promise<StoredTags>;
    write(source: string, metadata: TrackMetadata): Promise<void>;
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
