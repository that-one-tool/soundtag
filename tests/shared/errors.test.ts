import assert from "node:assert/strict";
import { test } from "node:test";
import {
    getErrorMessage,
    ignoreServiceError,
    ServiceError,
} from "../../src/shared/errors.js";

test("getErrorMessage reads Error messages and stringifies other values", () => {
    assert.equal(getErrorMessage(new Error("broken")), "broken");
    assert.equal(getErrorMessage("plain failure"), "plain failure");
    assert.equal(getErrorMessage(42), "42");
});

test("ignoreServiceError absorbs service failures and rethrows bugs", () => {
    assert.equal(ignoreServiceError(new ServiceError("HTTP 500")), null);
    assert.throws(() => ignoreServiceError(new TypeError("bug")), TypeError);
});
