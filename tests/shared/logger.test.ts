import assert from "node:assert/strict";
import { test } from "node:test";
import { consoleLogger } from "../../src/shared/logger.js";
import { captureConsole } from "../helpers/console.js";

const output = captureConsole();

test("consoleLogger writes info to stdout and errors to stderr", () => {
    consoleLogger.info("progress");
    consoleLogger.error("failure");

    assert.deepEqual(output.logs, ["progress"]);
    assert.deepEqual(output.errors, ["failure"]);
});
