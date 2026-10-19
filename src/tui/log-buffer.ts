import type { Logger } from "../shared/logger.js";
import { Listeners } from "./listeners.js";

export interface LogLine {
    text: string;
    isError: boolean;
}

const DEFAULT_MAX_LINES = 200;

export class LogBuffer implements Logger {
    private readonly listeners = new Listeners();
    private lines: readonly LogLine[] = [];

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
        const added = message
            .split("\n")
            .filter((text) => text.trim())
            .map((text) => ({ text, isError }));
        this.lines = [...this.lines, ...added].slice(-this.maxLines);
        this.listeners.notify();
    }
}
