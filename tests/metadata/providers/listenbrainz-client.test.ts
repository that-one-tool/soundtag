import assert from "node:assert/strict";
import { test } from "node:test";
import { ListenBrainzClient } from "../../../src/metadata/providers/listenbrainz-client.js";
import type { ProviderServices } from "../../../src/metadata/types.js";
import { createFakeClock } from "../../helpers/clock.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createProviderServices } from "../../helpers/metadata-chain.js";

restoreFetchAfterEach();
const userAgent = "SoundTag/1.0 (test@example.com)";
const search = { title: "Title", artist: "Artist", album: "" };

function mockListenBrainz(payload: unknown, status = 200) {
    const requests: { url: URL; headers: Headers }[] = [];
    globalThis.fetch = async (input, init) => {
        requests.push({
            url: new URL(input.toString()),
            headers: new Headers(init?.headers),
        });
        return Response.json(payload, { status });
    };
    return requests;
}

function createClient(services: Partial<ProviderServices> = {}) {
    return new ListenBrainzClient(
        { token: "secret", userAgent },
        createProviderServices(services)
    );
}

test("ListenBrainzClient looks up a recording with its metadata", async () => {
    const requests = mockListenBrainz({ recording_mbid: "id" });

    const match = await createClient().lookUp({ ...search, album: "Album" });

    assert.deepEqual(match, { recording_mbid: "id" });
    const [{ url, headers }] = requests;
    assert.equal(url.pathname, "/1/metadata/lookup/");
    assert.deepEqual(Object.fromEntries(url.searchParams), {
        artist_name: "Artist",
        recording_name: "Title",
        release_name: "Album",
        metadata: "true",
        inc: "artist tag release",
    });
    assert.equal(headers.get("authorization"), "Token secret");
    assert.equal(headers.get("user-agent"), userAgent);
});

test("ListenBrainzClient leaves out an unknown album", async () => {
    const requests = mockListenBrainz({ recording_mbid: "id" });

    await createClient().lookUp(search);

    assert.equal(requests[0].url.searchParams.has("release_name"), false);
});

test("ListenBrainzClient returns null when nothing matches", async () => {
    mockListenBrainz({});

    assert.equal(await createClient().lookUp(search), null);
});

test("ListenBrainzClient reports HTTP failures", async () => {
    mockListenBrainz({ error: "Server error" }, 500);

    await assert.rejects(
        createClient().lookUp(search),
        /ListenBrainz request failed: HTTP 500/
    );
});

test("ListenBrainzClient points at the token when it is rejected", async () => {
    mockListenBrainz({ error: "Invalid authorization token." }, 401);

    await assert.rejects(
        createClient().lookUp(search),
        /^Error: ListenBrainz rejected the token: check LISTENBRAINZ_TOKEN\.$/
    );
});

test("ListenBrainzClient spaces its requests one second apart", async () => {
    const clock = createFakeClock();
    mockListenBrainz({});
    const client = createClient({ clock });

    await Promise.all([client.lookUp(search), client.lookUp(search)]);

    assert.deepEqual(clock.sleeps, [1000]);
});
