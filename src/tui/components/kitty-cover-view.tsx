import { Box, measureElement, useWindowSize, type DOMElement } from "ink";
import { createContext, useContext, useEffect, useRef } from "react";
import { CoverOverlay, type CoverPlacer } from "../cover-overlay.js";
import type { CoverBox, CoverSpot, PngCover } from "../types.js";

// Without a provider, covers are laid out but written nowhere.
const NO_TERMINAL = new CoverOverlay(() => {});

export const CoverPlacerContext = createContext<CoverPlacer>(NO_TERMINAL);

function getCoverSpot(element: DOMElement, box: CoverBox): CoverSpot {
    const { x, y } = measureElement(element);
    return { row: y, column: x, ...box };
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
    box: CoverBox;
}

// Ink only lays out the empty box; the terminal draws the image over it.
export function KittyCoverView({ cover, box }: KittyCoverViewProps) {
    const placer = useContext(CoverPlacerContext);
    const element = useRef<DOMElement>(null);
    useInvalidateOnResize(placer);
    useEffect(() => {
        if (element.current) {
            placer.show(cover, getCoverSpot(element.current, box));
        }
    });
    useEffect(() => () => placer.hide(), [placer]);

    return (
        <Box
            ref={element}
            width={box.columns}
            height={box.rows}
            flexShrink={0}
        />
    );
}
