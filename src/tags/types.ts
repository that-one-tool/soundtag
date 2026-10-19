import type { TrackInfo, TrackMetadata } from "../metadata/types.js";

export interface StoredTags {
    info: TrackInfo;
    hasCover: boolean;
}

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
