import * as path from "node:path";
import type { QueueState } from "./types.js";

function describePending(state: QueueState): string {
    return state.pending.length > 0 ? ` · ${state.pending.length} queued` : "";
}

function describeStop(state: QueueState, quitting: boolean): string {
    if (quitting) {
        return " · quitting after the current file (press q again to force)";
    }

    return state.stopping ? " · stopping after the current file" : "";
}

export function describeQueue(state: QueueState, quitting: boolean): string {
    if (!state.running) {
        return "Idle";
    }

    const running = `Tagging ${path.basename(state.running.path)}`;
    return `${running}${describePending(state)}${describeStop(state, quitting)}`;
}
