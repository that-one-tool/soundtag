import { EventEmitter } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

export const KEYS = {
    up: "\u001B[A",
    down: "\u001B[B",
    right: "\u001B[C",
    left: "\u001B[D",
    enter: "\r",
    escape: "\u001B",
    backspace: "\u007F",
    ctrlC: "\u0003",
};

export async function waitFor(
    condition: () => boolean,
    timeoutMilliseconds = 2000
): Promise<void> {
    const deadline = Date.now() + timeoutMilliseconds;

    while (!condition()) {
        if (Date.now() > deadline) {
            throw new Error("Timed out waiting for condition.");
        }

        await delay(5);
    }
}

export function waitForFrame(
    lastFrame: () => string | undefined,
    text: string
): Promise<void> {
    return waitFor(() => (lastFrame() ?? "").includes(text)).catch(() => {
        throw new Error(`Frame never showed "${text}":\n${lastFrame()}`);
    });
}

export function findFrameLine(
    lastFrame: () => string | undefined,
    text: string
): string {
    return (
        (lastFrame() ?? "").split("\n").find((line) => line.includes(text)) ??
        ""
    );
}

interface TerminalSize {
    columns: number;
    rows: number;
}

class FakeStdout extends EventEmitter {
    columns: number;
    rows: number;
    output = "";

    constructor({ columns, rows }: TerminalSize = { columns: 100, rows: 30 }) {
        super();
        this.columns = columns;
        this.rows = rows;
    }

    write = (...chunkAndCallback: unknown[]): boolean => {
        const callback = chunkAndCallback.findLast(
            (argument) => typeof argument === "function"
        ) as (() => void) | undefined;
        callback?.();
        this.output += String(chunkAndCallback[0]);
        return true;
    };
}

class FakeStdin extends EventEmitter {
    readonly isTTY = true;
    private data: string | null = null;

    write(data: string): void {
        this.data = data;
        this.emit("readable");
        this.emit("data", data);
    }

    read = (): string | null => {
        const { data } = this;
        this.data = null;
        return data;
    };

    setEncoding(): void {}
    setRawMode(): void {}
    resume(): void {}
    pause(): void {}
    ref(): void {}
    unref(): void {}
}

export function waitForInput(stdin: EventEmitter): Promise<void> {
    return waitFor(() => stdin.listenerCount("readable") > 0);
}

export function createFakeTerminal(size?: TerminalSize) {
    const stdin = new FakeStdin();
    const stdout = new FakeStdout(size);
    const streams = {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
        stderr: new FakeStdout() as unknown as NodeJS.WriteStream,
    };
    return { stdin, stdout, streams };
}
