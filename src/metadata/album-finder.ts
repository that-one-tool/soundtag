import {
    HttpStatusError,
    ignoreServiceError,
    ServiceError,
} from "../shared/errors.js";
import type { ImageRequest } from "../shared/http.js";
import type {
    AlbumSearch,
    AlbumSource,
    FoundAlbum,
    ProviderServices,
} from "./types.js";

interface LookupState {
    failed: boolean;
}

interface ConfirmedAlbum {
    found: FoundAlbum;
    source: AlbumSource;
}

// Rate limits (429) and slow answers (408) are worth asking again.
const MISSING_IMAGE_STATUSES: ReadonlySet<number> = new Set([404, 410]);

function isMissingImage(error: unknown): boolean {
    return (
        error instanceof HttpStatusError &&
        MISSING_IMAGE_STATUSES.has(error.status)
    );
}

// Only a missing image is kept as missing; a slow or failing service is asked again.
function noteDownloadFailure(error: unknown, state: LookupState): null {
    if (!isMissingImage(error)) {
        state.failed = true;
    }

    return ignoreServiceError(error);
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
        // Asked for a cover when the confirmed album's cannot be downloaded.
        readonly coverSources: AlbumSource[],
        private readonly services: ProviderServices
    ) {}

    async findAlbum(search: AlbumSearch): Promise<FoundAlbum | null> {
        const confirmed = await this.confirmAlbum(search);
        return confirmed && confirmed.found;
    }

    private confirmAlbum(search: AlbumSearch): Promise<ConfirmedAlbum | null> {
        const key = `album:${getSearchKey(search)}`;
        return this.services.cache
            .getOrLoad(key, () => this.lookUp(search))
            .catch(ignoreServiceError);
    }

    // The chosen image is kept for the batch, so a missing cover is not asked for by every file.
    async findCover(search: AlbumSearch): Promise<Buffer | null> {
        const key = `album-cover:${getSearchKey(search)}`;
        const request = await this.services.cache
            .getOrLoad(key, () => this.pickCover(search))
            .catch(ignoreServiceError);
        return request ? this.downloadCover(request) : null;
    }

    private downloadCover(request: ImageRequest): Promise<Buffer | null> {
        return this.services.images.download(request).catch(ignoreServiceError);
    }

    // An album not confirmed yet may be after a service failure, so it is not kept.
    private async pickCover(search: AlbumSearch): Promise<ImageRequest | null> {
        const confirmed = await this.confirmAlbum(search);
        if (!confirmed) {
            throw new ServiceError("No confirmed album.");
        }

        return this.pickConfirmedCover(search, confirmed);
    }

    private async pickConfirmedCover(
        search: AlbumSearch,
        { found, source }: ConfirmedAlbum
    ): Promise<ImageRequest | null> {
        const state = { failed: false };
        const request =
            (await this.findWorkingCover(found.covers, state)) ??
            (await this.findBackupCover(search, source, state));
        return request ?? getMiss(state);
    }

    private findBackupCover(
        search: AlbumSearch,
        confirmedBy: AlbumSource,
        state: LookupState
    ): Promise<ImageRequest | null> {
        const step = { label: "cover", subject: describeSearch(search) };
        const backups = this.coverSources.filter(
            (source) => source !== confirmedBy
        );
        return this.services.lookups.step(step, () =>
            this.findFirstBackupCover(backups, search, state)
        );
    }

    private async findFirstBackupCover(
        backups: AlbumSource[],
        search: AlbumSearch,
        state: LookupState
    ): Promise<ImageRequest | null> {
        for (const source of backups) {
            const request = await this.findSourceCover(source, search, state);
            if (request) {
                return request;
            }
        }

        return null;
    }

    private async findSourceCover(
        source: AlbumSource,
        search: AlbumSearch,
        state: LookupState
    ): Promise<ImageRequest | null> {
        const found = await this.findInSource(source, search, state);
        return found && this.findWorkingCover(found.covers, state);
    }

    private async findWorkingCover(
        covers: ImageRequest[],
        state: LookupState
    ): Promise<ImageRequest | null> {
        for (const request of covers) {
            const image = await this.services.images
                .download(request)
                .catch((error: unknown) => noteDownloadFailure(error, state));
            if (image) {
                return request;
            }
        }

        return null;
    }

    private lookUp(search: AlbumSearch): Promise<ConfirmedAlbum | null> {
        const step = { label: "album", subject: describeSearch(search) };
        return this.services.lookups.step(step, () =>
            this.findInSources(search)
        );
    }

    private async findInSources(
        search: AlbumSearch
    ): Promise<ConfirmedAlbum | null> {
        const state = { failed: false };
        for (const source of this.sources) {
            const found = await this.findInSource(source, search, state);
            if (found) {
                return { found, source };
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
