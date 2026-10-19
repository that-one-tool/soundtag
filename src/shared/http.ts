const REQUEST_TIMEOUT = 10_000;

export interface ImageRequest {
    url: string | URL;
    headers?: Record<string, string>;
    byteLimit?: number;
}

export function fetchWithTimeout(
    url: string | URL,
    init: Omit<RequestInit, "signal"> = {}
): Promise<Response> {
    return fetch(url, {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });
}

export async function readJsonResponse<T>(
    response: Response,
    serviceName: string
): Promise<T> {
    if (!response.ok) {
        throw new Error(
            `${serviceName} request failed: HTTP ${response.status}`
        );
    }

    return (await response.json()) as T;
}

function assertSuccessfulImageResponse(response: Response): void {
    if (!response.ok) {
        throw new Error(`Image request failed: HTTP ${response.status}`);
    }
}

function assertImageContentType(response: Response): void {
    const contentType = response.headers.get("content-type") ?? "";

    if (!contentType.toLowerCase().startsWith("image/")) {
        throw new Error("Image response was not an image.");
    }
}

function assertBelowByteLimit(totalBytes: number, byteLimit: number): void {
    if (totalBytes >= byteLimit) {
        throw new Error("Image response was too large.");
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
    const response = await fetchWithTimeout(url, { headers });
    assertSuccessfulImageResponse(response);
    assertImageContentType(response);
    const data = await readBodyBelowLimit(response, byteLimit);

    if (data.length === 0) {
        throw new Error("Image response was empty.");
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
