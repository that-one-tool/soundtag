import "dotenv/config";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { runApp } from "./app.js";

const terminal = readline.createInterface({ input, output });
const inputClosed = new AbortController();
terminal.once("close", () => inputClosed.abort());

async function askTerminal(question: string): Promise<string> {
    try {
        return await terminal.question(question, {
            signal: inputClosed.signal,
        });
    } catch (error) {
        throw new Error("Input ended before an answer was given.", {
            cause: error,
        });
    }
}

try {
    process.exitCode = await runApp({
        argv: process.argv.slice(2),
        env: process.env,
        ask: askTerminal,
        workingDirectory: process.cwd(),
    });
} finally {
    terminal.close();
}
