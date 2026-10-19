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

    private append(message: string, isError: boolean): void {
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
