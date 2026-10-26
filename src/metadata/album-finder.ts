import { ignoreServiceError, ServiceError } from "../shared/errors.js";
import type {
    AlbumSearch,
    AlbumSource,
    FoundAlbum,
    ProviderServices,
} from "./types.js";

interface LookupState {
    failed: boolean;
}

// A service that failed may have the album, so the batch cache must not keep the miss.
function getMiss({ failed }: LookupState): null {
    if (failed) {
        throw new ServiceError("No album service answered.");
    }

    return null;
}

function getSearchKey({ artist, album }: AlbumSearch): string {
    return JSON.stringify([artist, album]);
}

function describeSearch({ artist, album }: AlbumSearch): string {
    return `"${album}" · ${artist}`;
}

// Every track of a folder asks for the same album, so the lookup is kept for the batch.
export class AlbumFinder {
    constructor(
        readonly sources: AlbumSource[],
        private readonly services: ProviderServices
    ) {}

    findAlbum(search: AlbumSearch): Promise<FoundAlbum | null> {
        const key = `album:${getSearchKey(search)}`;
        return this.services.cache
            .getOrLoad(key, () => this.lookUp(search))
            .catch(ignoreServiceError);
    }

    findCover({ covers }: FoundAlbum): Promise<Buffer | null> {
        return this.services.images.downloadFirst(covers);
    }

    private lookUp(search: AlbumSearch): Promise<FoundAlbum | null> {
        const step = { label: "album", subject: describeSearch(search) };
        return this.services.lookups.step(step, () =>
            this.findInSources(search)
        );
    }

    private async findInSources(
        search: AlbumSearch
    ): Promise<FoundAlbum | null> {
        const state = { failed: false };
        for (const source of this.sources) {
            const found = await this.findInSource(source, search, state);
            if (found) {
                return found;
            }
        }

        return getMiss(state);
    }

    private findInSource(
        source: AlbumSource,
        search: AlbumSearch,
        state: LookupState
    ): Promise<FoundAlbum | null> {
        // Each answer is kept, so a later track only asks the services that failed.
        const key = `album:${source.name}:${getSearchKey(search)}`;
        const find = () =>
            this.services.cache
                .getOrLoad(key, () => source.findAlbum(search))
                .catch((error: unknown) => {
                    state.failed = true;
                    throw error;
                });
        return this.services.lookups.call(
            source.name,
            find,
            ({ album }) => `"${album}"`
        );
    }
}
