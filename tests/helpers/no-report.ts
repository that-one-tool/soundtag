import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";

// Guards against reintroducing the removed soundtag_output.json report.
export async function assertNoReport(directory: string): Promise<void> {
    await assert.rejects(
        fs.access(path.join(directory, "soundtag_output.json"))
    );
}
