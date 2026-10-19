import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import { createTuiServices } from "../../src/tui/tui-services.js";
import { restoreFetchAfterEach } from "../helpers/fetch.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

restoreFetchAfterEach();
const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-tui-services-test-"
);

test("createTuiServices routes job results to the status store and logs", async () => {
    const directory = await createTemporaryDirectory();
    const source = path.join(directory, "Artist - Title.mp3");
    await fs.writeFile(source, "audio bytes");
    globalThis.fetch = async () => new Response(null, { status: 500 });
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: true,
        renameFiles: false,
        musicBrainzUserAgent: " ",
    });

    services.queue.enqueue({ kind: "file", path: source });
    await services.queue.whenIdle();

    assert.equal(services.statusStore.getSnapshot().get(source), "SKIPPED");
    const logText = services.logBuffer.getSnapshot().map((line) => line.text);
    assert.ok(
        logText.includes(
            "MusicBrainz fallback requires MUSICBRAINZ_USER_AGENT."
        )
    );
    assert.ok(logText.some((text) => text.startsWith("Searching:")));
});

test("createTuiServices deletes a folder report and logs it", async () => {
    const directory = await createTemporaryDirectory();
    const reportPath = path.join(directory, "soundtag_output.json");
    await fs.writeFile(reportPath, "{}");
    const services = createTuiServices({
        lastFmApiKey: "key",
        verbose: false,
        recursive: true,
        renameFiles: false,
    });

    await services.deleteReport(directory);

    await assert.rejects(fs.access(reportPath));
    const logText = services.logBuffer.getSnapshot().map((line) => line.text);
    assert.ok(logText.includes(`Deleted ${reportPath}`));
});
