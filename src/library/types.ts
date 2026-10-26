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

// From ".../<Artist> - <Album>/", whatever its files are named.
export type AlbumFolderTerms = Pick<LibraryPathTerms, "artist" | "album">;
