import sharp from "sharp";

// A PNG whose top half is red and bottom half is blue.
export function createSplitImage(size = 4): Promise<Buffer> {
    const pixels = Buffer.alloc(size * size * 3);
    for (let index = 0; index < size * size; index++) {
        const isTop = index < (size * size) / 2;
        pixels.set(isTop ? [255, 0, 0] : [0, 0, 255], index * 3);
    }
    return sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
        .png()
        .toBuffer();
}

// Detailed enough that most of the JPEG is image data rather than headers.
export function createDetailedJpeg(size = 256): Promise<Buffer> {
    const pixels = Buffer.alloc(size * size * 3);
    for (let index = 0; index < pixels.length; index++) {
        pixels[index] = (index * 7919) % 251;
    }
    return sharp(pixels, { raw: { width: size, height: size, channels: 3 } })
        .jpeg()
        .toBuffer();
}
