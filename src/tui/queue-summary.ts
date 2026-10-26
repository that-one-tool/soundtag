import * as path from "node:path";
import type { QueueState, TagJobSettings, TagTarget } from "./types.js";

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

export function describeRenamingChoice(enabled: boolean): string {
    return `renaming ${enabled ? "on" : "off"}`;
}

export function describeFixingChoice(enabled: boolean): string {
    return `fixing ${enabled ? "on" : "off"}`;
}

export function describeOverwritingChoice(enabled: boolean): string {
    return `overwriting ${enabled ? "on" : "off"}`;
}

function listSubfolderChoice(target: TagTarget): string[] {
    return target.kind === "folder"
        ? [describeSubfolderChoice(target.recursive)]
        : [];
}

// Only choices that differ from the defaults are worth naming.
const SETTING_CHOICES: [(settings: TagJobSettings) => boolean, string][] = [
    [(settings) => settings.renameFiles, describeRenamingChoice(true)],
    [(settings) => settings.fixTags, describeFixingChoice(true)],
    [(settings) => settings.overwriteTags, describeOverwritingChoice(true)],
];

function listSettingChoices(settings: TagJobSettings): string[] {
    return SETTING_CHOICES.filter(([differs]) => differs(settings)).map(
        ([, choice]) => choice
    );
}

function listTargetChoices(target: TagTarget): string[] {
    return [
        ...listSubfolderChoice(target),
        ...listSettingChoices(target.settings),
    ];
}

function describeTargetChoices(target: TagTarget): string {
    const choices = listTargetChoices(target);
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
