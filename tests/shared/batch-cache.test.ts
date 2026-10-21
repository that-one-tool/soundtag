import assert from "node:assert/strict";
import { test } from "node:test";
import { BatchCache } from "../../src/shared/batch-cache.js";

function createCountingLoader(value: string) {
    const loader = {
        calls: 0,
        load: async () => {
            loader.calls++;
            return value;
        },
    };
    return loader;
}

test("BatchCache loads each key once, including concurrent requests", async () => {
    const cache = new BatchCache();
    const loader = createCountingLoader("album");

    const values = await Promise.all([
        cache.getOrLoad("key", loader.load),
        cache.getOrLoad("key", loader.load),
    ]);
    await cache.getOrLoad("key", loader.load);

    assert.deepEqual(values, ["album", "album"]);
    assert.equal(loader.calls, 1);
});

test("BatchCache keeps keys apart", async () => {
    const cache = new BatchCache();

    await cache.getOrLoad("first", async () => "one");

    assert.equal(await cache.getOrLoad("second", async () => "two"), "two");
});

test("BatchCache loads again after a failure", async () => {
    const cache = new BatchCache();
    const failure = cache.getOrLoad("key", async () => {
        throw new Error("network down");
    });

    await assert.rejects(failure, /network down/);
    assert.equal(await cache.getOrLoad("key", async () => "retry"), "retry");
});

test("BatchCache loads again after being cleared", async () => {
    const cache = new BatchCache();
    const loader = createCountingLoader("album");

    await cache.getOrLoad("key", loader.load);
    cache.clear();
    await cache.getOrLoad("key", loader.load);

    assert.equal(loader.calls, 2);
});
