import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
    DEFAULT_CELL_RATIO,
    parseCellRatio,
    queryCellRatio,
} from "../../src/tui/cell-shape.js";

class FakeTtyStdin extends EventEmitter {
    isTTY = true;
    isRaw = false;
    rawWhileAsking = false;
    private chunks: string[] = [];
    setRawMode(raw: boolean): void {
        this.isRaw = raw;
    }
    send(text: string): void {
        this.chunks.push(text);
        this.emit("readable");
    }
    read(): string | null {
        return this.chunks.shift() ?? null;
    }
}

function createTerminal(reply?: string) {
    const stdin = new FakeTtyStdin();
    const writes: string[] = [];
    const stdout = {
        write: (text: string) => {
            writes.push(text);
            stdin.rawWhileAsking = stdin.isRaw;
            if (reply !== undefined) {
                stdin.send(reply);
            }
            return true;
        },
    };
    const streams = {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
    };
    return { stdin, writes, streams };
}

test("parseCellRatio divides the cell height by its width", () => {
    assert.equal(parseCellRatio("\u001B[6;18;8t"), 2.25);
    assert.equal(parseCellRatio("x\u001B[6;20;10t\u001B[4;1;1t"), 2);
});

test("parseCellRatio rejects other, empty or implausible sizes", () => {
    assert.equal(parseCellRatio("\u001B[6;8;10t"), null);
    assert.equal(parseCellRatio("\u001B[6;50;10t"), null);
    assert.equal(parseCellRatio(""), null);
    assert.equal(parseCellRatio("\u001B[4;1296;1712t"), null);
    assert.equal(parseCellRatio("\u001B[6;0;8t"), null);
    assert.equal(parseCellRatio("\u001B[6;18;0t"), null);
});

test("queryCellRatio asks the terminal and reads its reply in raw mode", async () => {
    const { stdin, writes, streams } = createTerminal("\u001B[6;18;8t");

    assert.equal(await queryCellRatio(streams), 2.25);
    assert.deepEqual(writes, ["\u001B[16t"]);
    assert.equal(stdin.rawWhileAsking, true);
    assert.equal(stdin.isRaw, false);
    assert.equal(stdin.listenerCount("readable"), 0);
});

test("queryCellRatio joins a reply split across chunks", async () => {
    const { stdin, streams } = createTerminal();
    const ratio = queryCellRatio(streams);

    stdin.send("\u001B[6;1");
    stdin.send("8;8t");

    assert.equal(await ratio, 2.25);
});

test("queryCellRatio falls back when the terminal does not answer", async () => {
    const { stdin, streams } = createTerminal();

    assert.equal(await queryCellRatio(streams, 1), DEFAULT_CELL_RATIO);
    assert.equal(stdin.listenerCount("readable"), 0);
});

test("queryCellRatio does not ask without a terminal on stdin", async () => {
    const { stdin, writes, streams } = createTerminal("\u001B[6;18;8t");
    stdin.isTTY = false;

    assert.equal(await queryCellRatio(streams), DEFAULT_CELL_RATIO);
    assert.deepEqual(writes, []);
});

test("queryCellRatio leaves stdin readable for Ink without pausing it", async () => {
    const stdin = Object.assign(new PassThrough(), {
        isTTY: true,
        isRaw: false,
        setRawMode: () => {},
    });
    const stdout = {
        write: () => stdin.write("\u001B[6;18;8t"),
    };
    const streams = {
        stdin: stdin as unknown as NodeJS.ReadStream,
        stdout: stdout as unknown as NodeJS.WriteStream,
    };

    assert.equal(await queryCellRatio(streams), 2.25);
    assert.equal(stdin.isPaused(), false);
    const key = new Promise((resolve) =>
        stdin.once("readable", () => resolve(String(stdin.read())))
    );
    stdin.write("q");
    assert.equal(await key, "q");
});
