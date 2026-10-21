import assert from "node:assert/strict";
import { test } from "node:test";
import { ServiceError } from "../../src/shared/errors.js";
import { LookupLog } from "../../src/shared/lookup-log.js";
import { createFakeClock } from "../helpers/clock.js";
import { createRecordingLogger } from "../helpers/logger.js";

function createLookupLog(verbose = false) {
    const logger = createRecordingLogger();
    const clock = createFakeClock();
    const lookups = new LookupLog({ logger, clock, verbose });
    return { logger, clock, lookups };
}

function takeAfter<T>(
    clock: ReturnType<typeof createFakeClock>,
    milliseconds: number,
    result: T
): () => Promise<T> {
    return async () => {
        clock.advance(milliseconds);
        return result;
    };
}

test("LookupLog writes one line per step with each call's outcome and time", async () => {
    const { logger, clock, lookups } = createLookupLog();

    await lookups.step({ label: "check" }, async () => {
        await lookups.call("ListenBrainz", takeAfter(clock, 460, { id: 1 }));
        await lookups.call("MusicBrainz", takeAfter(clock, 300, null));
        await lookups.call("Deezer", async () => {
            clock.advance(1000);
            throw new ServiceError("Deezer request failed: HTTP 500");
        });
    });

    assert.deepEqual(logger.infos, [
        "  check  ListenBrainz ✓ 0.5s · MusicBrainz no match 0.3s · Deezer ✗ HTTP 500 1.0s",
    ]);
});

test("LookupLog names the step subject and what each found call added", async () => {
    const { logger, clock, lookups } = createLookupLog();

    await lookups.step(
        { label: "search", subject: 'file name "Song" · Band' },
        async () => {
            await lookups.call(
                "Deezer",
                takeAfter(clock, 1700, ["genre", "cover"]),
                (fields) => fields.join(", ")
            );
        }
    );

    assert.deepEqual(logger.infos, [
        '  search file name "Song" · Band: Deezer ✓ genre, cover 1.7s',
    ]);
});

test("LookupLog adds notes to the running call", async () => {
    const { logger, clock, lookups } = createLookupLog();

    await lookups.step({ label: "check" }, async () => {
        await lookups.call("MusicBrainz", async () => {
            lookups.note("HTTP 503, retried");
            clock.advance(3100);
            return {};
        });
    });

    assert.deepEqual(logger.infos, [
        "  check  MusicBrainz ✓ (HTTP 503, retried) 3.1s",
    ]);
});

test("LookupLog separates the rate-limit wait from the request time", async () => {
    const { logger, clock, lookups } = createLookupLog();

    await lookups.step({ label: "check" }, async () => {
        await lookups.call("MusicBrainz", async () => {
            lookups.noteWait(2800);
            clock.advance(3100);
            return {};
        });
    });

    assert.deepEqual(logger.infos, [
        "  check  MusicBrainz ✓ 0.3s (+2.8s wait)",
    ]);
});

test("LookupLog counts repeated notes", async () => {
    const { logger, lookups } = createLookupLog();

    await lookups.call("ListenBrainz", async () => {
        lookups.note("MusicBrainz HTTP 503, retried");
        lookups.note("MusicBrainz HTTP 503, retried");
        return {};
    });

    assert.deepEqual(logger.infos, [
        "         ListenBrainz ✓ (MusicBrainz HTTP 503, retried ×2) 0.0s",
    ]);
});

test("LookupLog shows the step so far while a call runs", async () => {
    const { logger, clock, lookups } = createLookupLog();

    await lookups.step({ label: "check", subject: "swapped" }, async () => {
        await lookups.call("ListenBrainz", takeAfter(clock, 400, {}));
        await lookups.call("MusicBrainz", takeAfter(clock, 100, {}));
    });

    assert.deepEqual(logger.progresses, [
        "  check  swapped: ListenBrainz…",
        "  check  swapped: ListenBrainz ✓ 0.4s · MusicBrainz…",
    ]);
});

test("LookupLog returns null for a service failure outside a step", async () => {
    const { logger, lookups } = createLookupLog();

    const found = await lookups.call("Last.fm", async () => {
        throw new ServiceError("timed out");
    });

    assert.equal(found, null);
    assert.deepEqual(logger.infos, ["         Last.fm ✗ timed out 0.0s"]);
});

test("LookupLog lets other errors through so bugs fail the file", async () => {
    const { logger, lookups } = createLookupLog();

    await assert.rejects(
        lookups.step({ label: "search" }, () =>
            lookups.call("Deezer", async () => {
                throw new TypeError("broken parser");
            })
        ),
        TypeError
    );
    assert.deepEqual(logger.infos, ["  search Deezer ✗ broken parser 0.0s"]);
});

test("LookupLog writes nothing for a step without calls", async () => {
    const { logger, lookups } = createLookupLog();

    const result = await lookups.step({ label: "check" }, async () => 7);

    assert.equal(result, 7);
    assert.deepEqual(logger.infos, []);
});

test("LookupLog shows request URLs without secrets only when verbose", () => {
    const quiet = createLookupLog();
    const verbose = createLookupLog(true);
    const url = new URL("https://api.test/search?q=song&api_key=secret&key=k");

    quiet.lookups.request(url);
    verbose.lookups.request(url);

    assert.deepEqual(quiet.logger.infos, []);
    assert.deepEqual(verbose.logger.infos, [
        "         https://api.test/search?q=song&api_key=[REDACTED]&key=[REDACTED]",
    ]);
});

test("LookupLog shows the running call again after a verbose request URL", async () => {
    const { logger, lookups } = createLookupLog(true);

    await lookups.call("Deezer", async () => {
        lookups.request(new URL("https://api.test/search"));
        return {};
    });

    assert.deepEqual(logger.progresses, [
        "         Deezer…",
        "         Deezer…",
    ]);
});

test("LookupLog writes an inner step on its own line and resumes the outer one", async () => {
    const { logger, lookups } = createLookupLog();

    await lookups.step({ label: "search" }, async () => {
        await lookups.call("Deezer", async () => ({}));
        await lookups.step({ label: "check" }, () =>
            lookups.call("MusicBrainz", async () => null)
        );
        await lookups.call("iTunes", async () => null);
    });

    assert.deepEqual(logger.infos, [
        "  check  MusicBrainz no match 0.0s",
        "  search Deezer ✓ 0.0s · iTunes no match 0.0s",
    ]);
});

test("LookupLog notes a service failure but rethrows a bug", () => {
    const { lookups } = createLookupLog();

    assert.doesNotThrow(() =>
        lookups.noteFailure("album lookup", new ServiceError("HTTP 500"))
    );
    assert.throws(
        () => lookups.noteFailure("album lookup", new TypeError("bug")),
        TypeError
    );
});
