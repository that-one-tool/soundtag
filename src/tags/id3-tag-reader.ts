import * as fs from "node:fs/promises";

const HEADER_SIZE = 10;
const FOOTER_SIZE = 10;
const FOOTER_FLAG = 0x10;
const SIZE_BYTES = [6, 7, 8, 9];

// The same checks node-id3 applies before trusting a header.
const HEADER_CHECKS: ((header: Buffer) => boolean)[] = [
    (header) => header.length === HEADER_SIZE,
    (header) => header.toString("latin1", 0, 3) === "ID3",
    (header) => [2, 3, 4].includes(header[3]) && header[4] === 0,
    (header) => SIZE_BYTES.every((index) => header[index] < 0x80),
];

function isValidHeader(header: Buffer): boolean {
    return HEADER_CHECKS.every((check) => check(header));
}

function readSyncsafeSize(header: Buffer): number {
    return SIZE_BYTES.reduce((size, index) => (size << 7) | header[index], 0);
}

function getFooterSize(header: Buffer): number {
    return header[5] & FOOTER_FLAG ? FOOTER_SIZE : 0;
}

function getTagLength(header: Buffer): number {
    return HEADER_SIZE + readSyncsafeSize(header) + getFooterSize(header);
}

async function readStart(file: fs.FileHandle, length: number): Promise<Buffer> {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await file.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
}

async function readLeadingTag(file: fs.FileHandle): Promise<Buffer> {
    const header = await readStart(file, HEADER_SIZE);
    return isValidHeader(header)
        ? readStart(file, getTagLength(header))
        : file.readFile();
}

// node-id3 reads the whole file, so only the leading tag is passed to it.
export async function readId3TagBytes(source: string): Promise<Buffer> {
    const file = await fs.open(source);

    try {
        return await readLeadingTag(file);
    } finally {
        await file.close();
    }
}
