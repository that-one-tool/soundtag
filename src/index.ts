#!/usr/bin/env node
import { homedir } from "node:os";
import { runApp } from "./cli/app.js";
import {
    createBrowserLauncher,
    isInteractiveTerminal,
    runTuiLazily,
} from "./cli/browser-launcher.js";
import { loadEnvFiles } from "./cli/env-file.js";
import { openStopSession } from "./cli/stop-session.js";
import { consoleLogger } from "./shared/logger.js";

await loadEnvFiles({
    workingDirectory: process.cwd(),
    homeDirectory: homedir(),
    env: process.env,
    warn: consoleLogger.error,
});
const session = openStopSession();

try {
    process.exitCode = await runApp({
        argv: process.argv.slice(2),
        env: process.env,
        workingDirectory: process.cwd(),
        renewStopSignal: session.renewStopSignal,
        canBrowse: isInteractiveTerminal(process),
        openBrowser: createBrowserLauncher(
            { release: session.close, exit: process.exit.bind(process) },
            runTuiLazily
        ),
    });
} finally {
    session.close();
}
