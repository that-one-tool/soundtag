import type { Logger } from "../shared/logger.js";
import { Listeners } from "./listeners.js";

export interface LogLine {
    id: number;
    text: string;
    isError: boolean;
}

const DEFAULT_MAX_LINES = 200;

function isKeptLine(
    line: LogLine,
    index: number,
    lines: readonly LogLine[]
): boolean {
    return Boolean(line.text) || index === 0 || Boolean(lines[index - 1].text);
}

export class LogBuffer implements Logger {
    private readonly listeners = new Listeners();
    private lines: readonly LogLine[] = [];
    private nextId = 0;
    private progressId: number | null = null;

    constructor(private readonly maxLines = DEFAULT_MAX_LINES) {}

    subscribe = (listener: () => void): (() => void) =>
        this.listeners.add(listener);

    getSnapshot = (): readonly LogLine[] => this.lines;

    info(message: string): void {
        this.append(message, false);
    }

    error(message: string): void {
        this.append(message, true);
    }

    progress(message: string): void {
        if (!message) {
            this.removeProgress();
            this.listeners.notify();
            return;
        }

        // One line, so the next message can replace all of it.
        this.append(message.replaceAll("\n", " "), false);
        this.progressId = this.nextId - 1;
    }

    private removeProgress(): void {
        this.lines = this.lines.filter(({ id }) => id !== this.progressId);
        this.progressId = null;
    }

    private append(message: string, isError: boolean): void {
        this.removeProgress();
        const added = message.split("\n").map((text) => ({
            id: this.nextId++,
            text: text.trim() ? text : "",
            isError,
        }));
        this.lines = [...this.lines, ...added]
            .filter(isKeptLine)
            .slice(-this.maxLines);
        this.listeners.notify();
    }
}
