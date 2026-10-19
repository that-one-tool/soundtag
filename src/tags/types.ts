import type { TrackInfo, TrackMetadata } from "../metadata/types.js";

export interface StoredTags {
    info: TrackInfo;
    hasCover: boolean;
}

export interface TagStore {
    read(source: string): Promise<StoredTags>;
    write(source: string, metadata: TrackMetadata): Promise<void>;
}
