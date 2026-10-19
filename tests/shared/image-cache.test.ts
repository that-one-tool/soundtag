import assert from "node:assert/strict";
import { test } from "node:test";
import { ImageCache } from "../../src/shared/image-cache.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";

restoreFetchAfterEach();

function imageResponse(data: BodyInit): Response {
    return new Response(data, { headers: { "content-type": "image/jpeg" } });
}

function mockImageServer(requested: string[]): void {
    globalThis.fetch = async (input) => {
        requested.push(input.toString());
        return imageResponse(`image of ${input.toString()}`);
    };
}

function createFailingResponse(): {
    promise: Promise<Response>;
    fail: () => void;
} {
    let rejectResponse!: (reason: Error) => void;
    const promise = new Promise<Response>((_resolve, reject) => {
        rejectResponse = reject;
    });
    return { promise, fail: () => rejectResponse(new Error("network down")) };
}

function getImageUrl(name: string): string {
    return `https://example.test/${name}.jpg`;
}

test("download fetches a URL once and serves repeats from the cache", async () => {
    const requested: string[] = [];
    mockImageServer(requested);
    const images = new ImageCache();

    const first = await images.download({ url: getImageUrl("a") });
    const second = await images.download({ url: new URL(getImageUrl("a")) });

    assert.deepEqual(second, first);
    assert.deepEqual(requested, [getImageUrl("a")]);
});

test("download does not reuse an unlimited image for a byte-limited request", async () => {
    const requested: string[] = [];
    mockImageServer(requested);
    const images = new ImageCache();

    await images.download({ url: getImageUrl("a") });

    await assert.rejects(
        images.download({ url: getImageUrl("a"), byteLimit: 1 }),
        /too large/
    );
    assert.equal(requested.length, 2);
});

test("download shares one request between concurrent calls", async () => {
    const requested: string[] = [];
    mockImageServer(requested);
    const images = new ImageCache();

    await Promise.all([
        images.download({ url: getImageUrl("a") }),
        images.download({ url: getImageUrl("a") }),
    ]);

    assert.deepEqual(requested, [getImageUrl("a")]);
});

test("download forgets failures so the next call retries", async () => {
    let attempts = 0;
    globalThis.fetch = async () => {
        attempts += 1;
        return attempts === 1
            ? new Response(null, { status: 500 })
            : imageResponse("image");
    };
    const images = new ImageCache();

    await assert.rejects(images.download({ url: getImageUrl("a") }));

    assert.deepEqual(
        await images.download({ url: getImageUrl("a") }),
        Buffer.from("image")
    );
    assert.equal(attempts, 2);
});

test("download evicts the least recently used image beyond capacity", async () => {
    const requested: string[] = [];
    mockImageServer(requested);
    const images = new ImageCache(2);

    for (const name of ["a", "b", "a", "c", "a", "b"]) {
        await images.download({ url: getImageUrl(name) });
    }

    assert.deepEqual(requested, ["a", "b", "c", "b"].map(getImageUrl));
});

test("clear drops cached images", async () => {
    const requested: string[] = [];
    mockImageServer(requested);
    const images = new ImageCache();

    await images.download({ url: getImageUrl("a") });
    images.clear();
    await images.download({ url: getImageUrl("a") });

    assert.deepEqual(requested, ["a", "a"].map(getImageUrl));
});

test("a failure settling after clear keeps the newer cached image", async () => {
    const requested: string[] = [];
    const firstResponse = createFailingResponse();
    globalThis.fetch = (input) => {
        requested.push(input.toString());
        return requested.length === 1
            ? firstResponse.promise
            : Promise.resolve(imageResponse("image"));
    };
    const images = new ImageCache();
    const pending = images.download({ url: getImageUrl("a") });

    images.clear();
    await images.download({ url: getImageUrl("a") });
    firstResponse.fail();
    await assert.rejects(pending);
    await images.download({ url: getImageUrl("a") });

    assert.equal(requested.length, 2);
});

test("downloadFirst returns the first image that downloads", async () => {
    const requested: string[] = [];
    globalThis.fetch = async (input) => {
        requested.push(input.toString());
        return input.toString().endsWith("first.jpg")
            ? new Response(null, { status: 500 })
            : imageResponse("second-image");
    };

    const image = await new ImageCache().downloadFirst(
        ["first", "second", "third"].map((name) => ({
            url: getImageUrl(name),
        }))
    );

    assert.deepEqual(image, Buffer.from("second-image"));
    assert.deepEqual(requested, ["first", "second"].map(getImageUrl));
});

test("downloadFirst returns null when no image downloads", async () => {
    globalThis.fetch = async () => {
        throw new Error("network down");
    };
    const images = new ImageCache();

    assert.equal(await images.downloadFirst([{ url: getImageUrl("a") }]), null);
    assert.equal(await images.downloadFirst([]), null);
});
