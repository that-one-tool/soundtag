import type { CoverSpot } from "./types.js";

const ESC = "\u001B";
const CHUNK_SIZE = 4096;
const CHUNKS = new RegExp(`.{1,${CHUNK_SIZE}}`, "g");

// q=2 keeps the terminal from answering on stdin, where Ink would read keys.
function wrapCommand(control: string, payload = ""): string {
    const data = payload && `;${payload}`;
    return `${ESC}_G${control}${data}${ESC}\\`;
}

function getChunkControl(index: number, count: number, imageId: number) {
    const more = index < count - 1 ? 1 : 0;
    return index === 0 ? `a=t,f=100,i=${imageId},q=2,m=${more}` : `m=${more}`;
}

export function buildTransmission(png: Buffer, imageId: number): string {
    const chunks = png.toString("base64").match(CHUNKS) ?? [];
    return chunks
        .map((chunk, index) =>
            wrapCommand(getChunkControl(index, chunks.length, imageId), chunk)
        )
        .join("");
}

// C=1 and the saved cursor leave Ink's cursor where Ink expects it. Without
// r, the terminal picks the rows that keep the cover square for its cell shape.
export function buildPlacement(spot: CoverSpot, imageId: number): string {
    const { row, column, columns } = spot;
    const placement = `a=p,i=${imageId},p=1,c=${columns},C=1,q=2`;
    const moveCursor = `${ESC}[${row + 1};${column + 1}H`;
    return `${ESC}7${moveCursor}${wrapCommand(placement)}${ESC}8`;
}

export function buildPlacementDeletion(imageId: number): string {
    return wrapCommand(`a=d,d=i,i=${imageId},q=2`);
}

export function buildDeletion(imageId: number): string {
    return wrapCommand(`a=d,d=I,i=${imageId},q=2`);
}
