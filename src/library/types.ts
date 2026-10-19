export interface TrackSearchTerms {
    title: string;
    artist?: string;
    album?: string;
}

export type FolderSearchTerms = Pick<TrackSearchTerms, "artist" | "album">;
