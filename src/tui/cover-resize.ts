import type { CoverArt } from "./types.js";

const RGB_CHANNELS = 3;

interface Span {
    start: number;
    end: number;
}

// Each target pixel covers at least one source pixel, even when upscaling.
function getSourceSpan(target: number, scale: number): Span {
    const start = Math.floor(target * scale);
    return {
        start,
        end: Math.max(Math.floor((target + 1) * scale), start + 1),
    };
}

function listSpan({ start, end }: Span): number[] {
    return Array.from({ length: end - start }, (_, offset) => start + offset);
}

function averageBlock(art: CoverArt, columns: Span, rows: Span): number[] {
    const sums = [0, 0, 0];
    const offsets = listSpan(rows).flatMap((y) =>
        listSpan(columns).map((x) => (y * art.width + x) * RGB_CHANNELS)
    );
    for (const offset of offsets) {
        sums.forEach(
            (_, channel) => (sums[channel] += art.pixels[offset + channel])
        );
    }
    return sums.map((sum) => Math.round(sum / offsets.length));
}

// Shrinks a square cover by averaging the source pixels under each target one.
export function resizeCoverArt(art: CoverArt, size: number): CoverArt {
    if (size === art.width) {
        return art;
    }

    const scale = art.width / size;
    const pixels = new Uint8Array(size * size * RGB_CHANNELS);
    for (let index = 0; index < size * size; index++) {
        const columns = getSourceSpan(index % size, scale);
        const rows = getSourceSpan(Math.floor(index / size), scale);
        pixels.set(averageBlock(art, columns, rows), index * RGB_CHANNELS);
    }
    return { width: size, height: size, pixels };
}
