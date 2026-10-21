import assert from "node:assert/strict";
import { test } from "node:test";
import { YouTubeCoverProvider } from "../../../src/metadata/providers/youtube.js";
import { captureConsole } from "../../helpers/console.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createProviderServices } from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();
const output = captureConsole();
const search = { title: "Title", artist: "Artist", album: "" };

function mockYouTube(searchResponse: unknown, requested: string[]): void {
    globalThis.fetch = async (input) => {
        const url = new URL(input.toString());
        requested.push(url.href);

        if (url.hostname === "www.googleapis.com") {
            return Response.json(searchResponse);
        }

        return new Response("thumbnail", {
            headers: { "content-type": "image/jpeg" },
        });
    };
}

test("YouTubeCoverProvider downloads the largest available thumbnail", async () => {
    const requested: string[] = [];
    mockYouTube(
        {
            items: [
                {
                    snippet: {
                        thumbnails: {
                            default: {
                                url: "https://i.ytimg.test/default.jpg",
                            },
                            high: { url: "https://i.ytimg.test/high.jpg" },
                        },
                    },
                },
            ],
        },
        requested
    );

    const cover = await new YouTubeCoverProvider(
        "key",
        createProviderServices()
    ).findCover(search);

    assert.deepEqual(cover, Buffer.from("thumbnail"));
    assert.equal(requested[1], "https://i.ytimg.test/high.jpg");
    assert.equal(new URL(requested[0]).searchParams.get("q"), "Artist Title");
});

test("YouTubeCoverProvider prefers maxres, then standard thumbnails", async () => {
    for (const [thumbnails, expected] of [
        [
            {
                standard: { url: "https://i.ytimg.test/standard.jpg" },
                maxres: { url: "https://i.ytimg.test/maxres.jpg" },
            },
            "https://i.ytimg.test/maxres.jpg",
        ],
        [
            {
                high: { url: "https://i.ytimg.test/high.jpg" },
                standard: { url: "https://i.ytimg.test/standard.jpg" },
            },
            "https://i.ytimg.test/standard.jpg",
        ],
    ] as const) {
        const requested: string[] = [];
        mockYouTube({ items: [{ snippet: { thumbnails } }] }, requested);

        await new YouTubeCoverProvider(
            "key",
            createProviderServices()
        ).findCover(search);

        assert.equal(requested[1], expected);
    }
});

test("YouTubeCoverProvider returns null when no video has a thumbnail", async () => {
    for (const response of [{}, { items: [] }, { items: [{ snippet: {} }] }]) {
        const requested: string[] = [];
        mockYouTube(response, requested);

        assert.equal(
            await new YouTubeCoverProvider(
                "key",
                createProviderServices()
            ).findCover(search),
            null
        );
        assert.equal(requested.length, 1);
    }
});

test("YouTubeCoverProvider lets a failed search reach the lookup log", async () => {
    globalThis.fetch = async () => new Response(null, { status: 403 });

    await assert.rejects(
        new YouTubeCoverProvider("key", createProviderServices()).findCover(
            search
        ),
        /HTTP 403/
    );
    assert.deepEqual(output.errors, []);
});
