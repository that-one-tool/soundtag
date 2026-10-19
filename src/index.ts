import "dotenv/config";
import { runApp } from "./cli/app.js";
import { openTerminalSession } from "./cli/terminal.js";

const session = openTerminalSession();

try {
    process.exitCode = await runApp({
        argv: process.argv.slice(2),
        env: process.env,
        ask: session.ask,
        workingDirectory: process.cwd(),
        renewStopSignal: session.renewStopSignal,
    });
} finally {
    session.close();
}
