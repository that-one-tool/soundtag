import assert from "node:assert/strict";
import { test } from "node:test";
import { TaggingQueue } from "../../src/tui/tagging-queue.js";
import type { TagTarget } from "../../src/tui/types.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { DEFAULT_JOB_SETTINGS } from "../helpers/tui.js";

interface ControlledJob {
    target: TagTarget;
    stopSignal: AbortSignal;
    finish(succeeded: boolean): void;
}

function createControlledQueue() {
    const jobs: ControlledJob[] = [];
    const logger = createRecordingLogger();
    const queue = new TaggingQueue(
        (target, stopSignal) =>
            new Promise<boolean>((resolve) =>
                jobs.push({ target, stopSignal, finish: resolve })
            ),
        logger
    );
    return { queue, jobs, logger };
}

const album: TagTarget = {
    kind: "folder",
    settings: DEFAULT_JOB_SETTINGS,
    path: "/music/Album",
    recursive: true,
};
const single: TagTarget = {
    kind: "file",
    settings: DEFAULT_JOB_SETTINGS,
    path: "/music/single.mp3",
};

test("TaggingQueue runs targets one at a time in order", async () => {
    const { queue, jobs } = createControlledQueue();

    queue.enqueue(album);
    queue.enqueue(single);

    assert.deepEqual(queue.getSnapshot().running, album);
    assert.deepEqual(queue.getSnapshot().pending, [single]);
    assert.equal(jobs.length, 1);

    jobs[0].finish(true);
    await new Promise(setImmediate);

    assert.deepEqual(queue.getSnapshot().running, single);
    jobs[1].finish(true);
    await queue.whenIdle();

    assert.deepEqual(queue.getSnapshot(), {
        running: null,
        pending: [],
        stopping: false,
        failed: false,
    });
});

test("TaggingQueue ignores and logs a target that is already queued or running", () => {
    const { queue, logger } = createControlledQueue();

    queue.enqueue(album);
    queue.enqueue(single);
    queue.enqueue({ ...album, recursive: false });
    queue.enqueue({ ...single });

    assert.deepEqual(queue.getSnapshot().pending, [single]);
    assert.deepEqual(logger.infos, [
        "Already queued: Album (subfolders on).",
        "Already queued: single.mp3.",
    ]);
});

test("TaggingQueue stop aborts the running job and drops pending ones", async () => {
    const { queue, jobs } = createControlledQueue();
    queue.enqueue(album);
    queue.enqueue(single);

    queue.stop();

    assert.equal(jobs[0].stopSignal.aborted, true);
    assert.deepEqual(queue.getSnapshot().pending, []);
    assert.equal(queue.getSnapshot().stopping, true);

    jobs[0].finish(true);
    await queue.whenIdle();

    assert.equal(jobs.length, 1);
    assert.equal(queue.getSnapshot().stopping, false);
});

test("TaggingQueue stop does nothing when idle", () => {
    const { queue } = createControlledQueue();
    const before = queue.getSnapshot();

    queue.stop();

    assert.equal(queue.getSnapshot(), before);
});

test("TaggingQueue gives each job a fresh stop signal", async () => {
    const { queue, jobs } = createControlledQueue();
    queue.enqueue(album);
    queue.stop();
    jobs[0].finish(true);
    await queue.whenIdle();

    queue.enqueue(single);

    assert.equal(jobs[1].stopSignal.aborted, false);
    assert.equal(queue.getSnapshot().stopping, false);
});

test("TaggingQueue remembers failed and rejected jobs", async () => {
    const failing = new TaggingQueue(
        async () => false,
        createRecordingLogger()
    );
    failing.enqueue(album);
    await failing.whenIdle();
    assert.equal(failing.getSnapshot().failed, true);

    const throwing = new TaggingQueue(async () => {
        throw new Error("boom");
    }, createRecordingLogger());
    throwing.enqueue(album);
    await throwing.whenIdle();
    assert.equal(throwing.getSnapshot().failed, true);
    assert.equal(throwing.getSnapshot().running, null);
});

test("TaggingQueue notifies subscribers on every change", async () => {
    const { queue, jobs } = createControlledQueue();
    let notifications = 0;
    queue.subscribe(() => notifications++);

    queue.enqueue(album);
    jobs[0].finish(true);
    await queue.whenIdle();

    assert.ok(notifications >= 2);
});

test("TaggingQueue moves the queued targets inside a renamed folder", () => {
    const { queue } = createControlledQueue();
    const inside: TagTarget = {
        kind: "file",
        settings: DEFAULT_JOB_SETTINGS,
        path: "/music/Album/a.mp3",
    };
    const other: TagTarget = {
        kind: "file",
        settings: DEFAULT_JOB_SETTINGS,
        path: "/music/Albums/a.mp3",
    };
    queue.enqueue(album);
    queue.enqueue(getDiscTarget());
    queue.enqueue(inside);
    queue.enqueue(other);
    let notifications = 0;
    queue.subscribe(() => notifications++);

    queue.moveTargets({ source: "/music/Album", destination: "/music/A - B" });

    assert.deepEqual(queue.getSnapshot().running, {
        ...album,
        path: "/music/A - B",
    });
    assert.deepEqual(queue.getSnapshot().pending, [
        {
            kind: "folder",
            settings: DEFAULT_JOB_SETTINGS,
            path: "/music/A - B/CD1",
            recursive: false,
        },
        {
            kind: "file",
            settings: DEFAULT_JOB_SETTINGS,
            path: "/music/A - B/a.mp3",
        },
        other,
    ]);
    assert.equal(notifications, 1);
});

function getDiscTarget(): TagTarget {
    return {
        kind: "folder",
        settings: DEFAULT_JOB_SETTINGS,
        path: "/music/Album/CD1",
        recursive: false,
    };
}

test("TaggingQueue moves nothing while idle", () => {
    const { queue } = createControlledQueue();

    queue.moveTargets({ source: "/music/Album", destination: "/music/A - B" });

    assert.equal(queue.getSnapshot().running, null);
});

test("TaggingQueue is busy with paths inside or around its targets", () => {
    const { queue } = createControlledQueue();
    queue.enqueue(album);
    queue.enqueue(single);

    assert.equal(queue.isBusyWith("/music/Album"), true);
    assert.equal(queue.isBusyWith("/music/Album/a.mp3"), true);
    assert.equal(queue.isBusyWith("/music"), true);
    assert.equal(queue.isBusyWith("/music/single.mp3"), true);
    assert.equal(queue.isBusyWith("/music/Other"), true);
    assert.equal(queue.isBusyWith("/elsewhere/Other"), false);
});

// A file job may rename its siblings' folder once it is done.
test("TaggingQueue is busy with the folder of a queued file", () => {
    const { queue } = createControlledQueue();
    queue.enqueue({
        kind: "file",
        settings: DEFAULT_JOB_SETTINGS,
        path: "/music/Album/a.mp3",
    });

    assert.equal(queue.isBusyWith("/music/Album/b.mp3"), true);
    assert.equal(queue.isBusyWith("/music/Album/CD1"), true);
    assert.equal(queue.isBusyWith("/music/Other"), false);
});

test("TaggingQueue leaves the siblings of a queued folder alone", () => {
    const { queue } = createControlledQueue();
    queue.enqueue(album);

    assert.equal(queue.isBusyWith("/music/Album 2"), false);
});

test("TaggingQueue is busy with nothing while idle", () => {
    const { queue } = createControlledQueue();

    assert.equal(queue.isBusyWith("/music/Album"), false);
});

const jazz = "/music/Queen/Queen - Jazz";

function albumFile(...parts: string[]): TagTarget {
    return {
        kind: "file",
        settings: DEFAULT_JOB_SETTINGS,
        path: [jazz, ...parts].join("/"),
    };
}

test("TaggingQueue keeps the whole album busy for one of its files", () => {
    const { queue } = createControlledQueue();

    queue.enqueue(albumFile("CD1", "Queen - Mustapha.mp3"));

    assert.equal(queue.isBusyWith(`${jazz}/CD2/Queen - Fun It.mp3`), true);
    assert.equal(queue.isBusyWith("/music/Queen/Queen - Bicycle.mp3"), false);
});

test("TaggingQueue keeps the album busy for its disc folder", () => {
    const { queue } = createControlledQueue();

    queue.enqueue({
        kind: "folder",
        settings: DEFAULT_JOB_SETTINGS,
        path: `${jazz}/CD1`,
        recursive: false,
    });

    assert.equal(queue.isBusyWith(`${jazz}/CD2`), true);
});

test("TaggingQueue does not queue another file of a queued album", () => {
    const { queue, logger } = createControlledQueue();

    queue.enqueue(single);
    queue.enqueue(albumFile("Queen - Mustapha.mp3"));
    queue.enqueue(albumFile("Queen - Fun It.mp3"));
    queue.enqueue({ ...single, path: "/music/other.mp3" });

    assert.equal(queue.getSnapshot().pending.length, 2);
    assert.deepEqual(logger.infos, ["Already queued: Queen - Mustapha.mp3."]);
});
