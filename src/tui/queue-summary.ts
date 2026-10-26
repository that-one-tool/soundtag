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

export function describeOverwriteChoice(enabled: boolean): string {
    return `overwrite ${enabled ? "on" : "off"}`;
}

function listSubfolderChoice(target: TagTarget): string[] {
    return target.kind === "folder"
        ? [describeSubfolderChoice(target.recursive)]
        : [];
}

// Only an overwrite differs from the defaults enough to be worth naming.
function listOverwriteChoice(target: TagTarget): string[] {
    return target.settings.overwrite ? [describeOverwriteChoice(true)] : [];
}

function describeTargetChoices(target: TagTarget): string {
    const choices = [
        ...listSubfolderChoice(target),
        ...listOverwriteChoice(target),
    ];
    return choices.length > 0 ? ` (${choices.join(", ")})` : "";
}

export function describeTarget(target: TagTarget): string {
    return `${path.basename(target.path)}${describeTargetChoices(target)}`;
}

export function describeQueue(state: QueueState, quitting: boolean): string {
    if (!state.running) {
        return "Idle";
    }

    const running = `Tagging ${path.basename(state.running.path)}`;
    return `${running}${describePending(state)}${describeStop(state, quitting)}`;
}
