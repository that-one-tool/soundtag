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

class FakeStdout extends EventEmitter {
    readonly columns = 100;
    readonly rows = 30;
    write = (...chunkAndCallback: unknown[]): boolean => {
        const callback = chunkAndCallback.findLast(
            (argument) => typeof argument === "function"
        ) as (() => void) | undefined;
        callback?.();
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

export function createFakeTerminal() {
    const stdin = new FakeStdin();
    const streams = {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: new FakeStdout() as unknown as NodeJS.WriteStream,
        stderr: new FakeStdout() as unknown as NodeJS.WriteStream,
    };
    return { stdin, streams };
}
