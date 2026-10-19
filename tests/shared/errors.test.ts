import assert from "node:assert/strict";
import { test } from "node:test";
import {
    getErrorMessage,
    InputCancelledError,
} from "../../src/shared/errors.js";

test("getErrorMessage reads Error messages and stringifies other values", () => {
    assert.equal(getErrorMessage(new Error("broken")), "broken");
    assert.equal(getErrorMessage("plain failure"), "plain failure");
    assert.equal(getErrorMessage(42), "42");
});

test("InputCancelledError explains that input ended and keeps its cause", () => {
    const cause = new Error("aborted");
    const error = new InputCancelledError({ cause });

    assert.equal(error.message, "Input ended before an answer was given.");
    assert.equal(error.cause, cause);
    assert.ok(error instanceof Error);
});
