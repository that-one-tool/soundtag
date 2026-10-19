import { useState } from "react";
import type { LogBuffer } from "../log-buffer.js";
import { getActiveAnchor, scrollLog, type LogAnchor } from "../log-scroll.js";
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

function useLogAnchor(logBuffer: LogBuffer, height: number) {
    const [anchor, setAnchor] = useState<LogAnchor>({ anchorId: null, height });
    // Forget an anchor set for another height, so resizing back keeps the tail.
    if (anchor.height !== height) {
        setAnchor({ anchorId: null, height });
    }
    const scrollBy = (delta: number) =>
        setAnchor((current) => ({
            anchorId: scrollLog(logBuffer.getSnapshot(), height, {
                anchorId: getActiveAnchor(current, height),
                delta,
            }),
            height,
        }));
    return { anchorId: getActiveAnchor(anchor, height), scrollBy };
}

export function useLogView(logBuffer: LogBuffer, height: number): LogView {
    const [paneFocus] = useState(() => new PaneFocus());
    const { anchorId, scrollBy } = useLogAnchor(logBuffer, height);
    return {
        focus: useStore(paneFocus),
        anchorId,
        getFocus: paneFocus.getSnapshot,
        toggleFocus: () => paneFocus.toggle(),
        scrollLog: scrollBy,
    };
}
