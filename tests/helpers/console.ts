import { afterEach, beforeEach } from "node:test";

export interface CapturedConsole {
    logs: string[];
    errors: string[];
}

export function captureConsole(): CapturedConsole {
    const captured: CapturedConsole = { logs: [], errors: [] };
    const originalLog = console.log;
    const originalError = console.error;

    beforeEach(() => {
        captured.logs.length = 0;
        captured.errors.length = 0;
        console.log = (...values: unknown[]) => {
            captured.logs.push(values.map(String).join(" "));
        };
        console.error = (...values: unknown[]) => {
            captured.errors.push(values.map(String).join(" "));
        };
    });

    afterEach(() => {
        console.log = originalLog;
        console.error = originalError;
    });

    return captured;
}
