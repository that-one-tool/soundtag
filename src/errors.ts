export function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class InputCancelledError extends Error {
    constructor(options?: ErrorOptions) {
        super("Input ended before an answer was given.", options);
        this.name = "InputCancelledError";
    }
}
