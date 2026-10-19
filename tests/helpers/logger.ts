import type { Logger } from "../../src/shared/logger.js";

export interface RecordingLogger extends Logger {
    infos: string[];
    errors: string[];
}

export function createRecordingLogger(): RecordingLogger {
    const infos: string[] = [];
    const errors: string[] = [];

    return {
        infos,
        errors,
        info: (message) => infos.push(message),
        error: (message) => errors.push(message),
    };
}
