import assert from "node:assert/strict";
import { test } from "node:test";
import { getImageMimeType } from "../../src/tags/image-type.js";

test("getImageMimeType detects common image formats from their signature", () => {
    const signatures: [number[], string][] = [
        [[0xff, 0xd8, 0xff, 0xe0], "image/jpeg"],
        [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "image/png"],
        [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], "image/gif"],
        [
            [
                0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45,
                0x42, 0x50,
            ],
            "image/webp",
        ],
    ];

    for (const [bytes, mimeType] of signatures) {
        assert.equal(getImageMimeType(Buffer.from(bytes)), mimeType);
    }
});

test("getImageMimeType falls back to JPEG for unknown or short data", () => {
    assert.equal(getImageMimeType(Buffer.from("not an image")), "image/jpeg");
    assert.equal(getImageMimeType(Buffer.alloc(0)), "image/jpeg");
    assert.equal(
        getImageMimeType(Buffer.from([0x52, 0x49, 0x46, 0x46])),
        "image/jpeg"
    );
    assert.equal(
        getImageMimeType(Buffer.from("RIFF\0\0\0\0WAVE")),
        "image/jpeg"
    );
});
