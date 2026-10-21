import { useState } from "react";
import type { LogBuffer } from "../log-buffer.js";
import {
    getActiveAnchor,
    scrollLog,
    type LogAnchor,
    type LogSize,
} from "../log-scroll.js";
import { wrapLogLines } from "../log-wrap.js";
import { PaneFocus } from "../pane-focus.js";
import type { FocusedPane } from "../types.js";
import { useStore } from "./use-store.js";

export interface LogView {
    focus: FocusedPane;
    anchorId: number | null;
    getFocus(): FocusedPane;
    toggleFocus(): void;
    scrollLog(delta: number): void;
}

function useLogAnchor(logBuffer: LogBuffer, size: LogSize) {
    const [anchor, setAnchor] = useState<LogAnchor>({
        anchorId: null,
        ...size,
    });
    // Forget an anchor set for another size, so resizing back keeps the tail.
    if (getActiveAnchor(anchor, size) === null && anchor.anchorId !== null) {
        setAnchor({ anchorId: null, ...size });
    }
    const scrollBy = (delta: number) =>
        setAnchor((current) => ({
            anchorId: scrollLog(
                wrapLogLines(logBuffer.getSnapshot(), size.width),
                size.height,
                { anchorId: getActiveAnchor(current, size), delta }
            ),
            ...size,
        }));
    return { anchorId: getActiveAnchor(anchor, size), scrollBy };
}

export function useLogView(logBuffer: LogBuffer, size: LogSize): LogView {
    const [paneFocus] = useState(() => new PaneFocus());
    const { anchorId, scrollBy } = useLogAnchor(logBuffer, size);
    return {
        focus: useStore(paneFocus),
        anchorId,
        getFocus: paneFocus.getSnapshot,
        toggleFocus: () => paneFocus.toggle(),
        scrollLog: scrollBy,
    };
}
