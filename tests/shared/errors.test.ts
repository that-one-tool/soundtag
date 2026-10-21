import assert from "node:assert/strict";
import { test } from "node:test";
import { getErrorMessage } from "../../src/shared/errors.js";

test("getErrorMessage reads Error messages and stringifies other values", () => {
    assert.equal(getErrorMessage(new Error("broken")), "broken");
    assert.equal(getErrorMessage("plain failure"), "plain failure");
    assert.equal(getErrorMessage(42), "42");
});
