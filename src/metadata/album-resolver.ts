import { stripRemasterNote } from "./track-matching.js";
import type {
    AlbumData,
    AlbumTrackEntry,
    AlbumSearch,
    AlbumSource,
    FoundAlbum,
    ProviderServices,
} from "./types.js";

// Sources in the order each field is taken from.
export interface AlbumSourceOrder {
    identity: AlbumSource[];
    year: AlbumSource[];
    genre: AlbumSource[];
    tracks: AlbumSource[];
    cover: AlbumSource[];
}

type FieldReader<Value> = (
    found: FoundAlbum
) => Value | undefined | Promise<Value | undefined>;

const FOUND_FIELDS: [string, FieldReader<unknown>][] = [
    ["year", ({ year }) => year],
    ["genre", ({ genre }) => genre],
    ["tracklist", ({ tracks }) => tracks?.length],
    ["cover", ({ covers }) => covers.length],
];

function describeFound(found: FoundAlbum): string {
    return FOUND_FIELDS.filter(([, read]) => read(found))
        .map(([name]) => name)
        .join(", ");
}

function foldName(name: string): string {
    return name.normalize("NFC").trim().toLowerCase();
}

function getAlbumKey({ artist, album }: AlbumSearch): string {
    return `album-data:${JSON.stringify([foldName(artist), foldName(album)])}`;
}

function getFolderAlbum({ artist, album }: AlbumSearch): AlbumData {
    return {
        album,
        artist,
        year: "",
        genre: "",
        cover: null,
        tracks: [],
        found: false,
    };
}

// One search per source and album, shared by every field that needs it.
class AlbumLookup {
    private readonly results = new Map<
        AlbumSource,
        Promise<FoundAlbum | null>
    >();

    constructor(
        private readonly search: AlbumSearch,
        private readonly services: ProviderServices
    ) {}

    async findFirst<Value>(
        sources: AlbumSource[],
        read: FieldReader<Value>
    ): Promise<Value | undefined> {
        for (const source of sources) {
            const value = await this.readFrom(source, read);
            if (value !== undefined) {
                return value;
            }
        }
        return undefined;
    }

    private async readFrom<Value>(
        source: AlbumSource,
        read: FieldReader<Value>
    ): Promise<Value | undefined> {
        const found = await this.find(source);
        return found ? read(found) : undefined;
    }

    private find(source: AlbumSource): Promise<FoundAlbum | null> {
        const known = this.results.get(source) ?? this.ask(source);
        this.results.set(source, known);
        return known;
    }

    private ask(source: AlbumSource): Promise<FoundAlbum | null> {
        return this.services.lookups.call(
            source.name,
            () => source.findAlbum(this.search),
            describeFound
        );
    }
}

async function findText(
    lookup: AlbumLookup,
    sources: AlbumSource[],
    read: FieldReader<string>
): Promise<string> {
    return (await lookup.findFirst(sources, read)) ?? "";
}

function readTracks({ tracks }: FoundAlbum) {
    return tracks?.length ? tracks : undefined;
}

export class AlbumResolver {
    constructor(
        readonly order: AlbumSourceOrder,
        private readonly services: ProviderServices
    ) {}

    // Sibling disc folders ask for the same album, so it is kept for the batch.
    resolve(search: AlbumSearch, fileCount?: number): Promise<AlbumData> {
        const subject = `"${search.album}" · ${search.artist}`;
        return this.services.cache.getOrLoad(getAlbumKey(search), () =>
            this.services.lookups.step({ label: "album", subject }, () =>
                this.lookUp(search, fileCount)
            )
        );
    }

    private async lookUp(
        search: AlbumSearch,
        fileCount: number | undefined
    ): Promise<AlbumData> {
        const lookup = new AlbumLookup(search, this.services);
        const identity = await lookup.findFirst(
            this.order.identity,
            (found) => found
        );
        return identity
            ? this.collect(lookup, identity, fileCount)
            : getFolderAlbum(search);
    }

    private async collect(
        lookup: AlbumLookup,
        identity: FoundAlbum,
        fileCount: number | undefined
    ): Promise<AlbumData> {
        const { order } = this;
        return {
            album: stripRemasterNote(identity.album),
            artist: identity.artist,
            year: await findText(lookup, order.year, (found) => found.year),
            genre: await findText(lookup, order.genre, (found) => found.genre),
            cover: await this.findCover(lookup),
            tracks: await this.findTracks(lookup, fileCount),
            found: true,
        };
    }

    // Editions differ in bonus tracks, so the one the folder holds comes first.
    private async findTracks(
        lookup: AlbumLookup,
        fileCount: number | undefined
    ): Promise<AlbumTrackEntry[]> {
        const fitsFolder = ({ tracks }: FoundAlbum) =>
            tracks?.length === fileCount ? tracks : undefined;
        const fitting = await lookup.findFirst(this.order.tracks, fitsFolder);
        return (
            fitting ??
            (await lookup.findFirst(this.order.tracks, readTracks)) ??
            []
        );
    }

    private async findCover(lookup: AlbumLookup): Promise<Buffer | null> {
        const { images } = this.services;
        const cover = await lookup.findFirst(
            this.order.cover,
            async ({ covers }) =>
                (await images.downloadFirst(covers)) ?? undefined
        );
        return cover ?? null;
    }
}
