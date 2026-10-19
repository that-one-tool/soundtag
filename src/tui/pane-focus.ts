import { Listeners } from "./listeners.js";
import type { FocusedPane } from "./types.js";

const NEXT_FOCUS: Record<FocusedPane, FocusedPane> = {
    browser: "log",
    log: "browser",
};

// A store rather than React state, so a key right after Tab already sees
// the new focus.
export class PaneFocus {
    private readonly listeners = new Listeners();
    private focus: FocusedPane = "browser";

    subscribe = (listener: () => void): (() => void) =>
        this.listeners.add(listener);

    getSnapshot = (): FocusedPane => this.focus;

    toggle(): void {
        this.focus = NEXT_FOCUS[this.focus];
        this.listeners.notify();
    }
}
