import type { CoverArt } from "./types.js";

export interface CoverSize {
    width: number;
    height: number;
}

export type CoverDecoder = (
    image: Buffer,
    size: CoverSize
) => Promise<CoverArt>;

// Loaded on first use so a broken native install costs only the covers.
async function loadSharp() {
    const { default: sharp } = await import("sharp");
    sharp.cache(false);
    return sharp;
}

export async function decodeWithSharp(
    image: Buffer,
    { width, height }: CoverSize
): Promise<CoverArt> {
    const sharp = await loadSharp();
    const { data, info } = await sharp(image, { failOn: "none" })
        .resize(width, height, { fit: "cover" })
        .flatten({ background: "#000000" })
        .toColourspace("srgb")
        .raw()
        .toBuffer({ resolveWithObject: true });
    return { width: info.width, height: info.height, pixels: data };
}
