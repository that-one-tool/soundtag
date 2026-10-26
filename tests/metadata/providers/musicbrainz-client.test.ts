import assert from "node:assert/strict";
import { test } from "node:test";
import {
    getMusicBrainzArtist,
    MusicBrainzClient,
} from "../../../src/metadata/providers/musicbrainz-client.js";
import type { ProviderServices } from "../../../src/metadata/types.js";
import { createFakeClock } from "../../helpers/clock.js";
import { restoreFetchAfterEach } from "../../helpers/fetch.js";
import { createRecordingLogger } from "../../helpers/logger.js";
import { createProviderServices } from "../../helpers/metadata-chain.js";
import { LookupLog } from "../../../src/shared/lookup-log.js";

restoreFetchAfterEach();
const userAgent = "SoundTag/1.0 (test@example.com)";
const search = { title: "Title", artist: "Artist", album: "Album" };

function mockMusicBrainzResponses(responses: (() => Response)[]): {
    sent: Response[];
    urls: URL[];
    headers: Headers[];
} {
    const sent: Response[] = [];
    const urls: URL[] = [];
    const headers: Headers[] = [];
    globalThis.fetch = async (input, init) => {
        urls.push(new URL(input.toString()));
        headers.push(new Headers(init?.headers));
        const response = responses[sent.length]();
        sent.push(response);
        return response;
    };
    return { sent, urls, headers };
}

function unavailable(retryAfter: string): () => Response {
    return () =>
        new Response("busy", {
            status: 503,
            headers: { "retry-after": retryAfter },
        });
}

const recordings = () =>
    Response.json({ recordings: [{ title: "Retried title" }] });

function createClient(services: Partial<ProviderServices> = {}) {
    return new MusicBrainzClient(
        userAgent,
        createProviderServices({ clock: createFakeClock(), ...services })
    );
}

test("MusicBrainzClient searches recordings by title, artist and album", async () => {
    const { urls, headers } = mockMusicBrainzResponses([recordings]);

    const found = await createClient().searchRecordings(search);

    assert.deepEqual(found, [{ title: "Retried title" }]);
    assert.equal(urls[0].pathname, "/ws/2/recording");
    assert.equal(
        urls[0].searchParams.get("query"),
        'recording:"Title" AND artist:"Artist" AND release:"Album"'
    );
    assert.equal(urls[0].searchParams.get("limit"), "1");
    assert.equal(headers[0].get("user-agent"), userAgent);
});

test("MusicBrainzClient returns no recordings when the list is missing", async () => {
    mockMusicBrainzResponses([() => Response.json({})]);

    assert.deepEqual(await createClient().searchRecordings(search), []);
});

test("MusicBrainzClient retries once after the Retry-After delay", async () => {
    const clock = createFakeClock();
    const { sent } = mockMusicBrainzResponses([unavailable("5"), recordings]);

    const found = await createClient({ clock }).searchRecordings(search);

    assert.equal(found[0].title, "Retried title");
    assert.equal(sent.length, 2);
    assert.equal(sent[0].bodyUsed, true);
    assert.deepEqual(clock.sleeps, [5000]);
});

test("MusicBrainzClient waits three seconds without a Retry-After header", async () => {
    const clock = createFakeClock();
    mockMusicBrainzResponses([
        () => new Response("busy", { status: 503 }),
        recordings,
    ]);

    await createClient({ clock }).searchRecordings(search);

    assert.deepEqual(clock.sleeps, [3000, 500]);
});

test("MusicBrainzClient rate-limits the retry", async () => {
    const clock = createFakeClock();
    mockMusicBrainzResponses([unavailable("0"), recordings]);

    await createClient({ clock }).searchRecordings(search);

    assert.deepEqual(clock.sleeps, [3500]);
});

test("MusicBrainzClient starts its requests at least 3.5 seconds apart", async () => {
    const clock = createFakeClock();
    const startedAt: number[] = [];
    const answers: ("timeout" | Response)[] = [
        Response.json({}),
        "timeout",
        Response.json({}),
        Response.json({}),
    ];
    globalThis.fetch = async () => {
        startedAt.push(clock.now());
        const answer = answers[startedAt.length - 1];
        if (answer === "timeout") {
            throw new DOMException("aborted", "TimeoutError");
        }
        return answer;
    };
    const client = createClient({ clock });

    await client.searchRecordings(search);
    await client.searchRecordings({ ...search, title: "Other" });
    await client.searchReleaseGroups({ artist: "Artist", album: "Album" });

    const gaps = startedAt
        .slice(1)
        .map((time, index) => time - startedAt[index]);
    assert.equal(startedAt.length, 4);
    assert.ok(
        gaps.every((gap) => gap >= 3500),
        `gaps: ${gaps.join(", ")}`
    );
});

test("MusicBrainzClient gives up after a second unavailable response", async () => {
    const { sent } = mockMusicBrainzResponses([
        unavailable("0"),
        unavailable("0"),
        recordings,
    ]);

    await assert.rejects(
        createClient().searchRecordings(search),
        /MusicBrainz request failed: HTTP 503/
    );
    assert.equal(sent.length, 2);
});

test("MusicBrainzClient does not retry other HTTP errors", async () => {
    const { sent } = mockMusicBrainzResponses([
        () => new Response(null, { status: 500 }),
        recordings,
    ]);

    await assert.rejects(createClient().searchRecordings(search));
    assert.equal(sent.length, 1);
});

test("MusicBrainzClient loads each release once per batch", async () => {
    const release = { id: "release-id", title: "The Wall" };
    const { urls } = mockMusicBrainzResponses([() => Response.json(release)]);
    const client = createClient();

    await Promise.all([
        client.getRelease("release-id"),
        client.getRelease("release-id"),
    ]);

    assert.deepEqual(await client.getRelease("release-id"), release);
    assert.equal(urls.length, 1);
    assert.equal(urls[0].pathname, "/ws/2/release/release-id");
    assert.equal(
        urls[0].searchParams.get("inc"),
        "recordings release-groups artist-credits"
    );
});

test("MusicBrainzClient builds Cover Art Archive requests with its User-Agent", () => {
    const request = createClient().getCoverRequest("release id");

    assert.equal(
        request.url.toString(),
        "https://coverartarchive.org/release/release%20id/front-500"
    );
    assert.deepEqual(request.headers, { "User-Agent": userAgent });
});

test("MusicBrainzClient searches each recording once per batch", async () => {
    const { urls } = mockMusicBrainzResponses([recordings, recordings]);
    const client = createClient();

    await client.searchRecordings(search);
    const found = await client.searchRecordings({ ...search });
    await client.searchRecordings({ ...search, title: "Other" });

    assert.equal(found[0].title, "Retried title");
    assert.equal(urls.length, 2);
});

test("MusicBrainzClient notes a retry and shows its requests when verbose", async () => {
    const logger = createRecordingLogger();
    const clock = createFakeClock();
    const lookups = new LookupLog({ logger, clock, verbose: true });
    mockMusicBrainzResponses([
        () => new Response("busy", { status: 503 }),
        recordings,
    ]);
    const client = createClient({ clock, logger, lookups });

    await lookups.call("MusicBrainz", () => client.searchRecordings(search));

    assert.equal(logger.infos.length, 3);
    assert.match(
        logger.infos[0],
        /^ {9}https:\/\/musicbrainz\.org\/ws\/2\/recording\?query=/
    );
    assert.equal(logger.infos[1], logger.infos[0]);
    assert.match(
        logger.infos[2],
        /^ {9}MusicBrainz ✓ \(MusicBrainz HTTP 503, retried\) 0\.0s \(\+3\.5s wait\)$/
    );
});

test("MusicBrainzClient searches many recordings without keeping them for the batch", async () => {
    const urls: URL[] = [];
    globalThis.fetch = async (input) => {
        urls.push(new URL(input.toString()));
        return Response.json({ recordings: [{ title: "Title" }] });
    };
    const client = createClient();

    await client.searchAllRecordings(search);
    const found = await client.searchAllRecordings(search);

    assert.equal(found[0].title, "Title");
    assert.deepEqual(
        urls.map((url) => url.searchParams.get("limit")),
        ["100", "100"]
    );
});

test("MusicBrainzClient searches release groups by album and artist", async () => {
    const { urls } = mockMusicBrainzResponses([
        () => Response.json({ "release-groups": [{ title: "Discovery" }] }),
        () => Response.json({}),
    ]);
    const client = createClient();
    const albumSearch = { artist: "Daft Punk", album: 'Dis"covery' };

    const groups = await client.searchReleaseGroups(albumSearch);
    const missing = await client.searchReleaseGroups(albumSearch);

    assert.deepEqual(groups, [{ title: "Discovery" }]);
    assert.deepEqual(missing, []);
    assert.equal(urls[0].pathname, "/ws/2/release-group");
    assert.equal(
        urls[0].searchParams.get("query"),
        'releasegroup:"Dis\\"covery" AND artist:"Daft Punk"'
    );
    assert.equal(urls[0].searchParams.get("limit"), "5");
});

test("MusicBrainzClient builds release group cover requests", () => {
    const request = createClient().getReleaseGroupCoverRequest("group id");

    assert.equal(
        request.url.toString(),
        "https://coverartarchive.org/release-group/group%20id/front-500"
    );
    assert.deepEqual(request.headers, { "User-Agent": userAgent });
});

test("getMusicBrainzArtist joins the credited names", () => {
    assert.equal(
        getMusicBrainzArtist([
            { name: "Daft Punk", joinphrase: " feat. " },
            { artist: { name: "Pharrell Williams" } },
        ]),
        "Daft Punk feat. Pharrell Williams"
    );
    assert.equal(getMusicBrainzArtist([{}]), "");
    assert.equal(getMusicBrainzArtist(), "");
});

// Each call answers with the next step: a timeout or a response.
function mockTimeouts(steps: ("timeout" | Response)[]): URL[] {
    const urls: URL[] = [];
    globalThis.fetch = async (input) => {
        urls.push(new URL(input.toString()));
        const step = steps[urls.length - 1];
        if (step === "timeout") {
            throw new DOMException("aborted", "TimeoutError");
        }
        return step;
    };
    return urls;
}

test("MusicBrainzClient retries once after a timeout and notes it", async () => {
    const logger = createRecordingLogger();
    const lookups = new LookupLog({
        logger,
        clock: createFakeClock(),
        verbose: false,
    });
    const urls = mockTimeouts([
        "timeout",
        Response.json({ recordings: [{ title: "Retried title" }] }),
    ]);
    const client = createClient({ lookups });

    const found = await lookups.call("MusicBrainz", () =>
        client.searchRecordings(search)
    );

    assert.equal(found?.[0].title, "Retried title");
    assert.equal(urls.length, 2);
    assert.match(logger.infos[0], /MusicBrainz timed out, retried/);
});

test("MusicBrainzClient gives up after a second timeout", async () => {
    const urls = mockTimeouts(["timeout", "timeout"]);

    await assert.rejects(createClient().searchRecordings(search), /timed out/);
    assert.equal(urls.length, 2);
});
