export interface TrackInfo {
    title: string;
    artist: string;
    album: string;
    year: string;
}

export interface TrackMetadata {
    info: TrackInfo;
    coverData: Buffer | null;
}

export interface TrackSearch {
    title: string;
    artist: string;
    album: string;
}

export interface MetadataProvider {
    findMetadata(
        search: TrackSearch,
        needsCover: boolean
    ): Promise<TrackMetadata | null>;
}

export interface CoverProvider {
    findCover(search: TrackSearch): Promise<Buffer | null>;
}
