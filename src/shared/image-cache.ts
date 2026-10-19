import { downloadImage, type ImageRequest } from "./http.js";

// Tracks of an album are processed together, so a few entries catch nearly every repeat.
const DEFAULT_CAPACITY = 20;

function getCacheKey({ url, byteLimit }: ImageRequest): string {
    return `${byteLimit ?? ""} ${url.toString()}`;
}

export class ImageCache {
    private readonly images = new Map<string, Promise<Buffer>>();

    constructor(private readonly capacity = DEFAULT_CAPACITY) {}

    download(request: ImageRequest): Promise<Buffer> {
        const key = getCacheKey(request);
        const loading = this.images.get(key) ?? this.start(key, request);
        this.images.delete(key);
        this.images.set(key, loading);
        this.evictOldest();
        return loading;
    }

    async downloadFirst(requests: ImageRequest[]): Promise<Buffer | null> {
        for (const request of requests) {
            const image = await this.download(request).catch(() => null);

            if (image) {
                return image;
            }
        }

        return null;
    }

    clear(): void {
        this.images.clear();
    }

    private start(key: string, request: ImageRequest): Promise<Buffer> {
        const loading = downloadImage(request);
        loading.catch(() => this.forget(key, loading));
        return loading;
    }

    private forget(key: string, loading: Promise<Buffer>): void {
        if (this.images.get(key) === loading) {
            this.images.delete(key);
        }
    }

    private evictOldest(): void {
        if (this.images.size > this.capacity) {
            this.images.delete(this.images.keys().next().value ?? "");
        }
    }
}
