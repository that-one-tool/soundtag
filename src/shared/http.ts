import {
    getErrorMessage,
    HttpStatusError,
    ServiceError,
    TimeoutError,
} from "./errors.js";

// Services that stall would hold up every file, while covers are larger downloads.
const API_REQUEST_TIMEOUT = 6_000;
const IMAGE_REQUEST_TIMEOUT = 10_000;

export interface ImageRequest {
    url: string | URL;
    headers?: Record<string, string>;
    byteLimit?: number;
}

function toServiceError(error: unknown): ServiceError {
    const isTimeout = error instanceof Error && error.name === "TimeoutError";
    return isTimeout
        ? new TimeoutError()
        : new ServiceError(getErrorMessage(error));
}

function rethrowAsServiceError(error: unknown): never {
    throw error instanceof ServiceError ? error : toServiceError(error);
}

function assertObjectPayload(payload: unknown, serviceName: string): void {
    if (typeof payload !== "object" || payload === null) {
        throw new ServiceError(
            `${serviceName} returned an unexpected response`
        );
    }
}

export function fetchWithTimeout(
    url: string | URL,
    init: Omit<RequestInit, "signal"> = {},
    timeout = API_REQUEST_TIMEOUT
): Promise<Response> {
    return fetch(url, { ...init, signal: AbortSignal.timeout(timeout) }).catch(
        rethrowAsServiceError
    );
}

export async function readJsonResponse<T>(
    response: Response,
    serviceName: string
): Promise<T> {
    if (!response.ok) {
        throw new ServiceError(
            `${serviceName} request failed: HTTP ${response.status}`
        );
    }

    const payload: unknown = await response.json().catch(rethrowAsServiceError);
    assertObjectPayload(payload, serviceName);
    return payload as T;
}

function assertSuccessfulImageResponse(response: Response): void {
    if (!response.ok) {
        throw new HttpStatusError(
            response.status,
            `Image request failed: HTTP ${response.status}`
        );
    }
}

function assertImageContentType(response: Response): void {
    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().startsWith("image/")) {
        throw new ServiceError("Image response was not an image.");
    }
}

function assertBelowByteLimit(totalBytes: number, byteLimit: number): void {
    if (totalBytes >= byteLimit) {
        throw new ServiceError("Image response was too large.");
    }
}

async function readBodyBelowLimit(
    response: Response,
    byteLimit: number
): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    for await (const chunk of response.body ?? []) {
        totalBytes += chunk.length;
        assertBelowByteLimit(totalBytes, byteLimit);
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

export async function downloadImage({
    url,
    headers,
    byteLimit = Number.POSITIVE_INFINITY,
}: ImageRequest): Promise<Buffer> {
    const response = await fetchWithTimeout(
        url,
        { headers },
        IMAGE_REQUEST_TIMEOUT
    );
    assertSuccessfulImageResponse(response);
    assertImageContentType(response);
    // The body can still break off or time out after the headers arrived.
    const data = await readBodyBelowLimit(response, byteLimit).catch(
        rethrowAsServiceError
    );

    if (data.length === 0) {
        throw new ServiceError("Image response was empty.");
    }

    return data;
}

export function getRetryAfterDelay(
    response: Response,
    fallbackDelay: number,
    maxDelay: number
): number {
    const retryAfter = (response.headers.get("retry-after") ?? "").trim();

    if (!/^\d+$/.test(retryAfter)) {
        return fallbackDelay;
    }

    return Math.min(Number(retryAfter) * 1000, maxDelay);
}
