export function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// A failure of the remote service, as opposed to a bug in SoundTag.
export class ServiceError extends Error {}

// Another service may still answer, but a bug must fail the file.
export function ignoreServiceError(error: unknown): null {
    if (error instanceof ServiceError) {
        return null;
    }

    throw error;
}
