import type { Logger } from "../../src/shared/logger.js";

export interface RecordingLogger extends Logger {
    infos: string[];
    errors: string[];
    progresses: string[];
}

export function createRecordingLogger(): RecordingLogger {
    const infos: string[] = [];
    const errors: string[] = [];
    const progresses: string[] = [];

    return {
        infos,
        errors,
        progresses,
        info: (message) => infos.push(message),
        error: (message) => errors.push(message),
        progress: (message) => progresses.push(message),
    };
}
