import { Box, measureElement, useWindowSize, type DOMElement } from "ink";
import { createContext, useContext, useEffect, useRef } from "react";
import { CoverOverlay, type CoverPlacer } from "../cover-overlay.js";
import type { CoverSpot, PngCover } from "../types.js";

// Without a provider, covers are laid out but written nowhere.
const NO_TERMINAL = new CoverOverlay(() => {});

export const CoverPlacerContext = createContext<CoverPlacer>(NO_TERMINAL);

// Each text row holds two half-block pixels, so the box is half as tall.
function getCoverSpot(box: DOMElement, size: number): CoverSpot {
    const { x, y } = measureElement(box);
    return { row: y, column: x, columns: size, rows: size / 2 };
}

// A resize may make the terminal drop the image while its spot stays.
function useInvalidateOnResize(placer: CoverPlacer): void {
    const { columns, rows } = useWindowSize();
    const size = `${columns}x${rows}`;
    const lastSize = useRef(size);

    useEffect(() => {
        if (lastSize.current !== size) {
            lastSize.current = size;
            placer.invalidate();
        }
    });
}

export interface KittyCoverViewProps {
    cover: PngCover;
    size: number;
}

// Ink only lays out the empty box; the terminal draws the image over it.
export function KittyCoverView({ cover, size }: KittyCoverViewProps) {
    const placer = useContext(CoverPlacerContext);
    const box = useRef<DOMElement>(null);
    useInvalidateOnResize(placer);
    useEffect(() => {
        if (box.current) {
            placer.show(cover, getCoverSpot(box.current, size));
        }
    });
    useEffect(() => () => placer.hide(), [placer]);

    return <Box ref={box} width={size} height={size / 2} flexShrink={0} />;
}
