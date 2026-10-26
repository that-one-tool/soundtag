import assert from "node:assert/strict";
import { test } from "node:test";
import {
    downloadImage,
    fetchWithTimeout,
    getRetryAfterDelay,
    readJsonResponse,
} from "../../src/shared/http.js";
import { ServiceError, TimeoutError } from "../../src/shared/errors.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";

restoreFetchAfterEach();

function withRetryAfter(value: string): Response {
    return new Response(null, {
        status: 503,
        headers: { "retry-after": value },
    });
}

function imageResponse(data: BodyInit): Response {
    return new Response(data, { headers: { "content-type": "image/jpeg" } });
}

test("fetchWithTimeout passes request options and a timeout signal", async () => {
    let receivedInit: RequestInit | undefined;
    globalThis.fetch = async (_input, init) => {
        receivedInit = init;
        return new Response("ok");
    };

    await fetchWithTimeout("https://example.test/", {
        headers: { "User-Agent": "SoundTag" },
    });

    assert.equal(
        new Headers(receivedInit?.headers).get("user-agent"),
        "SoundTag"
    );
    assert.ok(receivedInit?.signal instanceof AbortSignal);
});

function recordTimeouts(): number[] {
    const timeouts: number[] = [];
    const createTimeout = AbortSignal.timeout.bind(AbortSignal);
    AbortSignal.timeout = (milliseconds) => {
        timeouts.push(milliseconds);
        return createTimeout(milliseconds);
    };
    return timeouts;
}

test("API calls give up sooner than image downloads", async (context) => {
    const createTimeout = AbortSignal.timeout;
    context.after(() => {
        AbortSignal.timeout = createTimeout;
    });
    const timeouts = recordTimeouts();
    globalThis.fetch = async () => imageResponse("image");

    await fetchWithTimeout("https://example.test/");
    await downloadImage({ url: "https://example.test/cover.jpg" });

    assert.deepEqual(timeouts, [6000, 10_000]);
});

test("readJsonResponse parses successful responses", async () => {
    assert.deepEqual(
        await readJsonResponse(Response.json({ value: 1 }), "Service"),
        { value: 1 }
    );
});

test("readJsonResponse names the service and status on failure", async () => {
    await assert.rejects(
        readJsonResponse(new Response(null, { status: 429 }), "Service"),
        /^Error: Service request failed: HTTP 429$/
    );
});

test("downloadImage returns image bytes and sends request headers", async () => {
    let userAgent = "";
    globalThis.fetch = async (_input, init) => {
        userAgent = new Headers(init?.headers).get("user-agent") ?? "";
        return imageResponse("image-bytes");
    };

    const image = await downloadImage({
        url: "https://example.test/cover.jpg",
        headers: { "User-Agent": "SoundTag" },
    });

    assert.deepEqual(image, Buffer.from("image-bytes"));
    assert.equal(userAgent, "SoundTag");
});

test("downloadImage rejects failed, non-image, and empty responses", async () => {
    const cases: [Response, RegExp][] = [
        [new Response(null, { status: 404 }), /HTTP 404/],
        [
            new Response("text", { headers: { "content-type": "text/html" } }),
            /not an image/,
        ],
        [imageResponse(""), /empty/],
    ];

    for (const [response, error] of cases) {
        globalThis.fetch = async () => response;
        await assert.rejects(
            downloadImage({ url: "https://example.test/cover.jpg" }),
            error
        );
    }
});

test("downloadImage enforces an exclusive byte limit", async () => {
    globalThis.fetch = async () => imageResponse(new Uint8Array(10));
    await assert.rejects(
        downloadImage({ url: "https://example.test/a.jpg", byteLimit: 10 }),
        /too large/
    );

    globalThis.fetch = async () => imageResponse(new Uint8Array(9));
    assert.equal(
        (
            await downloadImage({
                url: "https://example.test/b.jpg",
                byteLimit: 10,
            })
        ).length,
        9
    );
});

test("getRetryAfterDelay converts Retry-After seconds within bounds", () => {
    assert.equal(getRetryAfterDelay(withRetryAfter("3"), 2000, 10_000), 3000);
    assert.equal(
        getRetryAfterDelay(withRetryAfter("60"), 2000, 10_000),
        10_000
    );
    assert.equal(
        getRetryAfterDelay(
            withRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT"),
            2000,
            10_000
        ),
        2000
    );
    assert.equal(
        getRetryAfterDelay(new Response(null, { status: 503 }), 2000, 10_000),
        2000
    );
});

test("getRetryAfterDelay falls back for blank or non-decimal values", () => {
    for (const value of ["", " ", "-5", "0x10", "1e1", "1.5"]) {
        assert.equal(
            getRetryAfterDelay(withRetryAfter(value), 2000, 10_000),
            2000,
            `Retry-After "${value}"`
        );
    }
});

test("downloadImage cancels the response body once the byte limit is reached", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            controller.enqueue(new Uint8Array(8));
        },
        cancel() {
            cancelled = true;
        },
    });
    globalThis.fetch = async () => imageResponse(body);

    await assert.rejects(
        downloadImage({ url: "https://example.test/a.jpg", byteLimit: 10 }),
        /too large/
    );
    assert.equal(cancelled, true);
});

test("fetchWithTimeout reports network failures and timeouts as service errors", async () => {
    globalThis.fetch = async () => {
        throw new TypeError("fetch failed");
    };
    await assert.rejects(fetchWithTimeout("https://example.test/"), (error) => {
        assert.ok(error instanceof ServiceError);
        assert.equal(error.message, "fetch failed");
        return true;
    });

    globalThis.fetch = async () => {
        throw new DOMException("aborted", "TimeoutError");
    };
    await assert.rejects(fetchWithTimeout("https://example.test/"), (error) => {
        assert.ok(error instanceof TimeoutError);
        assert.ok(error instanceof ServiceError);
        assert.equal(error.message, "timed out");
        return true;
    });
});

test("readJsonResponse reports failures and unreadable bodies as service errors", async () => {
    await assert.rejects(
        readJsonResponse(new Response(null, { status: 500 }), "Service"),
        ServiceError
    );
    await assert.rejects(
        readJsonResponse(new Response("not json"), "Service"),
        ServiceError
    );
});

test("downloadImage reports a bad image as a service error", async () => {
    globalThis.fetch = async () => new Response("text");

    await assert.rejects(
        downloadImage({ url: "https://example.test/cover.jpg" }),
        ServiceError
    );
});

test("downloadImage reports a body that breaks off as a service error", async () => {
    const body = new ReadableStream({
        pull(controller) {
            controller.error(new TypeError("terminated"));
        },
    });
    globalThis.fetch = async () => imageResponse(body);

    await assert.rejects(
        downloadImage({ url: "https://example.test/cover.jpg" }),
        new ServiceError("terminated")
    );
});

test("readJsonResponse rejects a body that is not an object", async () => {
    await assert.rejects(
        readJsonResponse(Response.json(null), "Service"),
        new ServiceError("Service returned an unexpected response")
    );
});
