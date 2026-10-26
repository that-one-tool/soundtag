export function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// A failure of the remote service, as opposed to a bug in SoundTag.
export class ServiceError extends Error {}

// A missing resource stays missing, unlike a failing or slow service.
export class HttpStatusError extends ServiceError {
    constructor(
        readonly status: number,
        message: string
    ) {
        super(message);
    }
}

// A slow answer may come in time when asked again, unlike an error.
export class TimeoutError extends ServiceError {
    constructor() {
        super("timed out");
    }
}

// Another service may still answer, but a bug must fail the file.
export function ignoreServiceError(error: unknown): null {
    if (error instanceof ServiceError) {
        return null;
    }

    throw error;
}
