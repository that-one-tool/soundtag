export interface TrackSearchTerms {
    title: string;
    artist?: string;
    album?: string;
}

export type FolderSearchTerms = Pick<TrackSearchTerms, "artist" | "album">;

// From ".../<Artist>/<Artist> - <Title>" or ".../<Artist> - <Album>/<Artist> - <Title>".
export interface LibraryPathTerms {
    title: string;
    artist: string;
    album: string;
}
