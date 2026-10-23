const ESC = "\u001B";
const CELL_SIZE_REQUEST = `${ESC}[16t`;
const CELL_SIZE_REPLY = new RegExp(`${ESC}\\[6;([1-9]\\d*);([1-9]\\d*)t`);
const REPLY_TIMEOUT_MS = 200;
const MIN_CELL_RATIO = 1;
const MAX_CELL_RATIO = 4;

// Cell height over width; half blocks always draw two pixels per row.
export const DEFAULT_CELL_RATIO = 2;

export interface CellQueryStreams {
    stdin: NodeJS.ReadStream;
    stdout: NodeJS.WriteStream;
}

function keepPlausible(ratio: number): number | null {
    return ratio >= MIN_CELL_RATIO && ratio <= MAX_CELL_RATIO ? ratio : null;
}

export function parseCellRatio(reply: string): number | null {
    const match = CELL_SIZE_REPLY.exec(reply);
    return match && keepPlausible(Number(match[1]) / Number(match[2]));
}

export function getCoverColumns(rows: number, cellRatio: number): number {
    return Math.round(rows * cellRatio);
}

function readAvailable(stdin: NodeJS.ReadStream): string {
    const chunks: string[] = [];
    for (let chunk = stdin.read(); chunk !== null; chunk = stdin.read()) {
        chunks.push(String(chunk));
    }
    return chunks.join("");
}

// Reads like Ink does: a data listener and pause() would stop the terminal
// handle, and Ink never resumes it.
function waitForCellRatio(stdin: NodeJS.ReadStream, timeoutMs: number) {
    return new Promise<number>((resolve) => {
        let reply = "";
        const finish = (ratio: number) => {
            clearTimeout(timer);
            stdin.off("readable", readReply);
            resolve(ratio);
        };
        const readReply = () => {
            reply += readAvailable(stdin);
            const ratio = parseCellRatio(reply);
            if (ratio) finish(ratio);
        };
        const timer = setTimeout(() => finish(DEFAULT_CELL_RATIO), timeoutMs);
        stdin.on("readable", readReply);
    });
}

// Must run before Ink reads stdin, which would take the reply for keys.
export async function queryCellRatio(
    { stdin, stdout }: CellQueryStreams,
    timeoutMs = REPLY_TIMEOUT_MS
): Promise<number> {
    if (!stdin.isTTY) {
        return DEFAULT_CELL_RATIO;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    const reply = waitForCellRatio(stdin, timeoutMs);
    stdout.write(CELL_SIZE_REQUEST);
    const ratio = await reply;
    stdin.setRawMode(wasRaw);
    return ratio;
}
