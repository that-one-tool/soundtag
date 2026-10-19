import * as path from "node:path";
import type { QueueState, TagTarget } from "./types.js";

function describePending(state: QueueState): string {
    return state.pending.length > 0 ? ` · ${state.pending.length} queued` : "";
}

function describeStop(state: QueueState, quitting: boolean): string {
    if (quitting) {
        return " · quitting after the current file (press q again to force)";
    }

    return state.stopping ? " · stopping after the current file" : "";
}

export function describeSubfolderChoice(included: boolean): string {
    return `subfolders ${included ? "on" : "off"}`;
}

function describeTargetSubfolders(target: TagTarget): string {
    if (target.kind === "file") {
        return "";
    }

    return ` (${describeSubfolderChoice(target.recursive)})`;
}

export function describeTarget(target: TagTarget): string {
    return `${path.basename(target.path)}${describeTargetSubfolders(target)}`;
}

export function describeQueue(state: QueueState, quitting: boolean): string {
    if (!state.running) {
        return "Idle";
    }

    const running = `Tagging ${path.basename(state.running.path)}`;
    return `${running}${describePending(state)}${describeStop(state, quitting)}`;
}
