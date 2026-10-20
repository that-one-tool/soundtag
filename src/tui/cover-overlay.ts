import {
    buildDeletion,
    buildPlacement,
    buildPlacementDeletion,
    buildTransmission,
} from "./kitty-graphics.js";
import type { CoverSpot, PngCover } from "./types.js";

export interface CoverPlacer {
    show(cover: PngCover, spot: CoverSpot): void;
    hide(): void;
    invalidate(): void;
    clear(): void;
}

type Write = (text: string) => void;

// Unusual ids keep clear of images that other programs placed.
const FIRST_IMAGE_ID = 4100;
const KEPT_IMAGES = 8;

function getSpotKey({ row, column, columns, rows }: CoverSpot): string {
    return [row, column, columns, rows].join(",");
}

// Keeps recent covers in the terminal so going back only places them again.
class SentImages {
    private readonly idsByKey = new Map<string, number>();

    constructor(private readonly write: Write) {}

    getId(cover: PngCover): number {
        const id = this.idsByKey.get(cover.key) ?? this.send(cover);
        this.idsByKey.delete(cover.key);
        this.idsByKey.set(cover.key, id);
        return id;
    }

    clear(): void {
        for (const id of this.idsByKey.values()) {
            this.write(buildDeletion(id));
        }
        this.idsByKey.clear();
    }

    private send(cover: PngCover): number {
        const id = this.takeFreeId();
        this.write(buildTransmission(cover.png, id));
        return id;
    }

    private takeFreeId(): number {
        if (this.idsByKey.size < KEPT_IMAGES) {
            return FIRST_IMAGE_ID + this.idsByKey.size;
        }

        const [oldestKey, oldestId] = this.idsByKey.entries().next().value!;
        this.idsByKey.delete(oldestKey);
        this.write(buildDeletion(oldestId));
        return oldestId;
    }
}

interface Placement {
    id: number;
    spotKey: string;
}

// The terminal keeps a placed image above the text Ink redraws, so an image
// is only placed again when it changes or moves.
export class CoverOverlay implements CoverPlacer {
    private readonly images: SentImages;
    private placed: Placement | null = null;

    constructor(private readonly write: Write) {
        this.images = new SentImages(write);
    }

    show(cover: PngCover, spot: CoverSpot): void {
        const next = {
            id: this.images.getId(cover),
            spotKey: getSpotKey(spot),
        };
        if (this.isPlaced(next)) {
            return;
        }

        this.write(buildPlacement(spot, next.id));
        this.removePlacementOtherThan(next.id);
        this.placed = next;
    }

    hide(): void {
        this.removePlacementOtherThan(null);
        this.placed = null;
    }

    invalidate(): void {
        this.placed = this.placed && { ...this.placed, spotKey: "" };
    }

    clear(): void {
        this.images.clear();
        this.placed = null;
    }

    private isPlaced({ id, spotKey }: Placement): boolean {
        return this.placed?.id === id && this.placed.spotKey === spotKey;
    }

    // Removing after placing the next cover avoids a blank gap between them.
    private removePlacementOtherThan(id: number | null): void {
        if (this.placed && this.placed.id !== id) {
            this.write(buildPlacementDeletion(this.placed.id));
        }
    }
}
