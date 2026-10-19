import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { test } from "node:test";
import {
    deleteReport,
    getReportPath,
    mergeReports,
    readReport,
    saveReport,
} from "../../src/processing/report-file.js";
import { createRecordingLogger } from "../helpers/logger.js";
import { useTemporaryDirectories } from "../helpers/temporary-directories.js";

const createTemporaryDirectory = useTemporaryDirectories(
    "soundtag-report-test-"
);

test("getReportPath places the report inside the folder", () => {
    assert.equal(
        getReportPath(path.join("music", "Rock")),
        path.join("music", "Rock", "soundtag_output.json")
    );
});

test("saveReport writes the report as JSON and logs its path", async () => {
    const reportPath = getReportPath(await createTemporaryDirectory());
    const logger = createRecordingLogger();

    const saved = await saveReport(
        reportPath,
        { files: { "a.mp3": "TAGGED" } },
        logger
    );

    assert.equal(saved, true);
    assert.deepEqual(JSON.parse(await fs.readFile(reportPath, "utf8")), {
        files: { "a.mp3": "TAGGED" },
    });
    assert.deepEqual(logger.infos, [
        "\nSaving report...",
        `Processing report written to ${reportPath}`,
    ]);
});

test("saveReport logs and returns false when the report cannot be written", async () => {
    const directory = await createTemporaryDirectory();
    const reportPath = getReportPath(path.join(directory, "missing"));
    const logger = createRecordingLogger();

    const saved = await saveReport(reportPath, { files: {} }, logger);

    assert.equal(saved, false);
    assert.equal(logger.errors.length, 1);
    assert.match(
        logger.errors[0],
        /^Could not write processing report to .*: ENOENT/
    );
});

test("mergeReports updates processed entries and keeps the others", () => {
    assert.deepEqual(
        mergeReports(
            {
                files: {
                    "a.mp3": "TAGGED",
                    "b.mp3": "FAILED",
                    "c.mp3": "SKIPPED",
                },
                renamed: { "a.mp3": "A - A.mp3" },
            },
            {
                files: { "b.mp3": "TAGGED", "c.mp3": "READ", "d.mp3": "READ" },
                renamed: { "b.mp3": "B - B.mp3" },
            }
        ),
        {
            files: {
                "a.mp3": "TAGGED",
                "b.mp3": "TAGGED",
                "c.mp3": "SKIPPED",
                "d.mp3": "READ",
            },
            renamed: { "a.mp3": "A - A.mp3", "b.mp3": "B - B.mp3" },
        }
    );
});

test("mergeReports leaves out renames when there are none", () => {
    assert.deepEqual(
        mergeReports({ files: {} }, { files: { "a.mp3": "TAGGED" } }),
        {
            files: { "a.mp3": "TAGGED" },
        }
    );
});

test("readReport reads a saved report", async () => {
    const reportPath = getReportPath(await createTemporaryDirectory());
    await fs.writeFile(
        reportPath,
        JSON.stringify({ files: { "a.mp3": "TAGGED" } })
    );

    assert.deepEqual(await readReport(reportPath), {
        files: { "a.mp3": "TAGGED" },
    });
});

test("readReport starts empty when the report is missing or invalid", async () => {
    const reportPath = getReportPath(await createTemporaryDirectory());

    assert.deepEqual(await readReport(reportPath), { files: {} });
    await fs.writeFile(reportPath, "not json");
    assert.deepEqual(await readReport(reportPath), { files: {} });
    for (const invalid of ["[]", '{"files":null}', '{"files":["x"]}']) {
        await fs.writeFile(reportPath, invalid);
        assert.deepEqual(await readReport(reportPath), { files: {} });
    }
});

test("readReport drops renames that are not an object", async () => {
    const reportPath = getReportPath(await createTemporaryDirectory());
    await fs.writeFile(
        reportPath,
        JSON.stringify({ files: { "a.mp3": "TAGGED" }, renamed: "oops" })
    );

    assert.deepEqual(await readReport(reportPath), {
        files: { "a.mp3": "TAGGED" },
    });
});

test("deleteReport removes the report and logs it", async () => {
    const reportPath = getReportPath(await createTemporaryDirectory());
    await fs.writeFile(reportPath, "{}");
    const logger = createRecordingLogger();

    await deleteReport(reportPath, logger);

    await assert.rejects(fs.access(reportPath));
    assert.deepEqual(logger.infos, [`Deleted ${reportPath}`]);
});

test("deleteReport logs when there is no report to delete", async () => {
    const directory = await createTemporaryDirectory();
    const logger = createRecordingLogger();

    await deleteReport(getReportPath(directory), logger);

    assert.deepEqual(logger.infos, [`No report to delete in ${directory}.`]);
    assert.deepEqual(logger.errors, []);
});

test("deleteReport logs an error when the report cannot be deleted", async () => {
    const reportPath = getReportPath(await createTemporaryDirectory());
    await fs.mkdir(reportPath);
    const logger = createRecordingLogger();

    await deleteReport(reportPath, logger);

    assert.equal(logger.errors.length, 1);
    assert.match(
        logger.errors[0],
        /^Could not delete .*soundtag_output\.json: /
    );
});
