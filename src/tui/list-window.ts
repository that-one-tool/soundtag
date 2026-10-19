export interface VisibleRange {
    start: number;
    end: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(Math.max(value, minimum), maximum);
}

export function getVisibleRange(
    itemCount: number,
    cursor: number,
    height: number
): VisibleRange {
    const visibleCount = Math.min(Math.max(height, 1), itemCount);
    const centeredStart = cursor - Math.floor(visibleCount / 2);
    const start = clamp(centeredStart, 0, itemCount - visibleCount);
    return { start, end: start + visibleCount };
}
