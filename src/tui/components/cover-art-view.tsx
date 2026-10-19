import { Box, Text } from "ink";
import { useMemo } from "react";
import { resizeCoverArt } from "../cover-resize.js";
import type { CoverArt } from "../types.js";

const RGB_CHANNELS = 3;
const RESET = "\u001B[0m";

function listIndexes(count: number): number[] {
    return Array.from({ length: count }, (_, index) => index);
}

function getPixel({ width, pixels }: CoverArt, x: number, y: number) {
    const offset = (y * width + x) * RGB_CHANNELS;
    return [...pixels.subarray(offset, offset + RGB_CHANNELS)].join(";");
}

// The block's foreground draws the upper pixel, its background the lower one.
function buildHalfBlock(cover: CoverArt, x: number, row: number): string {
    const upper = getPixel(cover, x, row * 2);
    const lower = getPixel(cover, x, row * 2 + 1);
    return `\u001B[38;2;${upper}m\u001B[48;2;${lower}m▀`;
}

// Prebuilt escapes keep Ink to one node per row instead of one per cell.
export function buildCoverRows(cover: CoverArt): string[] {
    return listIndexes(cover.height / 2).map((row) => {
        const cells = listIndexes(cover.width).map((x) =>
            buildHalfBlock(cover, x, row)
        );
        return cells.join("") + RESET;
    });
}

export interface CoverArtViewProps {
    cover: CoverArt;
    size: number;
}

export function CoverArtView({ cover, size }: CoverArtViewProps) {
    const rows = useMemo(
        () => buildCoverRows(resizeCoverArt(cover, size)),
        [cover, size]
    );
    return (
        <Box flexDirection="column" flexShrink={0}>
            {rows.map((row, index) => (
                <Text key={index} wrap="truncate">
                    {row}
                </Text>
            ))}
        </Box>
    );
}
