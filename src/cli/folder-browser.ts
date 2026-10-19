import * as path from "node:path";
import { findAudioFiles, listSubfolders } from "../library/file.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Ask } from "./config.js";

export interface FolderView {
    directory: string;
    subfolders: string[];
    audioFileCount: number;
}

export type BrowserStep =
    | { kind: "navigate"; directory: string; notice?: string }
    | { kind: "select"; directory: string }
    | { kind: "quit" };

const INVALID_CHOICE = "Invalid choice.";
const DECIMAL_NUMBER = /^\d+$/;

const COMMANDS = new Map<string, (directory: string) => BrowserStep>([
    ["s", (directory) => ({ kind: "select", directory })],
    ["q", () => ({ kind: "quit" })],
    [
        "0",
        (directory) => ({
            kind: "navigate",
            directory: path.dirname(directory),
        }),
    ],
]);

function findSubfolder(view: FolderView, choice: string): string | undefined {
    return DECIMAL_NUMBER.test(choice)
        ? view.subfolders[Number(choice) - 1]
        : undefined;
}

export function applyChoice(view: FolderView, choice: string): BrowserStep {
    const normalizedChoice = choice.trim().toLowerCase();
    const command = COMMANDS.get(normalizedChoice);

    if (command) {
        return command(view.directory);
    }

    const subfolder = findSubfolder(view, normalizedChoice);

    if (!subfolder) {
        return {
            kind: "navigate",
            directory: view.directory,
            notice: INVALID_CHOICE,
        };
    }

    return {
        kind: "navigate",
        directory: path.join(view.directory, subfolder),
    };
}

function printNotice(notice: string | undefined): void {
    if (notice) {
        console.log(notice);
    }
}

async function readFolderView(directory: string): Promise<FolderView> {
    try {
        const [subfolders, audioFiles] = await Promise.all([
            listSubfolders(directory),
            findAudioFiles(directory, false),
        ]);
        return { directory, subfolders, audioFileCount: audioFiles.length };
    } catch (error) {
        console.error(`Cannot read ${directory}: ${getErrorMessage(error)}`);
        return { directory, subfolders: [], audioFileCount: 0 };
    }
}

function printFolderView(view: FolderView): void {
    console.log(`\n${view.directory}  (${view.audioFileCount} audio files)`);
    console.log("  0) ..");
    view.subfolders.forEach((subfolder, index) =>
        console.log(`  ${index + 1}) ${subfolder}`)
    );
    console.log("  s) process this folder");
    console.log("  q) quit");
}

export async function browseFolder(
    ask: Ask,
    startDirectory: string
): Promise<string | undefined> {
    let step: BrowserStep = { kind: "navigate", directory: startDirectory };

    while (step.kind === "navigate") {
        printNotice(step.notice);
        const view = await readFolderView(step.directory);
        printFolderView(view);
        step = applyChoice(view, await ask("Choose a folder: "));
    }

    return step.kind === "select" ? step.directory : undefined;
}
