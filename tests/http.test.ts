import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
    downloadFirstImage,
    downloadImage,
    fetchWithTimeout,
    getRetryAfterDelay,
    readJsonResponse,
} from "../src/http.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

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

test("downloadFirstImage returns the first image that downloads", async () => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
        requested.push(input.toString());
        return input.toString().endsWith("first.jpg")
            ? new Response(null, { status: 500 })
            : imageResponse("second-image");
    };

    const image = await downloadFirstImage([
        { url: "https://example.test/first.jpg" },
        { url: "https://example.test/second.jpg" },
        { url: "https://example.test/third.jpg" },
    ]);

    assert.deepEqual(image, Buffer.from("second-image"));
    assert.deepEqual(requested, [
        "https://example.test/first.jpg",
        "https://example.test/second.jpg",
    ]);
});

test("downloadFirstImage returns null when no image downloads", async () => {
    globalThis.fetch = async () => {
        throw new Error("network down");
    };

    assert.equal(
        await downloadFirstImage([{ url: "https://example.test/a.jpg" }]),
        null
    );
    assert.equal(await downloadFirstImage([]), null);
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
