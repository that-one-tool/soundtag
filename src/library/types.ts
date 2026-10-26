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

// ".../<Artist>/<Artist> - <Album>[ - CD<n>]/", disc folders such as "CD1" included.
export interface AlbumFolder {
    folder: string;
    artist: string;
    album: string;
    disc: number | null;
}

export interface AlbumTrack {
    path: string;
    disc: number | null;
}

// Sibling disc folders ("Album - CD1", "Album - CD2") are units of their own,
// so the album lookup must be shared by artist and album.
export interface AlbumUnit {
    folder: string;
    artist: string;
    album: string;
    tracks: AlbumTrack[];
}

// Albums are tagged as a whole; singles one file at a time.
export interface TrackPlan {
    albums: AlbumUnit[];
    singles: string[];
}
