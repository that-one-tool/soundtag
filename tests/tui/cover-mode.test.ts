import assert from "node:assert/strict";
import { test } from "node:test";
import { detectCoverMode, parseCoverMode } from "../../src/tui/cover-mode.js";

const KONSOLE = { TERM: "xterm-256color" };

function detect(env: NodeJS.ProcessEnv, trueColor = true) {
    return detectCoverMode({ env, trueColor });
}

test("detectCoverMode uses kitty graphics in terminals that support them", () => {
    assert.equal(detect({ ...KONSOLE, KONSOLE_VERSION: "260801" }), "kitty");
    assert.equal(detect({ ...KONSOLE, KONSOLE_VERSION: "220400" }), "kitty");
    assert.equal(detect({ TERM: "xterm-kitty" }), "kitty");
    assert.equal(detect({ TERM_PROGRAM: "ghostty" }), "kitty");
});

test("detectCoverMode falls back to half blocks elsewhere", () => {
    assert.equal(detect({ ...KONSOLE, KONSOLE_VERSION: "211200" }), "blocks");
    assert.equal(detect({ TERM_PROGRAM: "WezTerm" }), "blocks");
    assert.equal(
        detect({ ...KONSOLE, KONSOLE_VERSION: "260801", TMUX: "/tmp/t" }),
        "blocks"
    );
    assert.equal(detect({}), "blocks");
});

test("detectCoverMode leaves kitty graphics out behind multiplexers", () => {
    assert.equal(detect({ TERM: "xterm-kitty", STY: "1.pts" }), "blocks");
    assert.equal(detect({ TERM: "xterm-kitty", ZELLIJ: "0" }), "blocks");
});

test("detectCoverMode ignores KONSOLE_VERSION inherited by another terminal", () => {
    const fromKonsole = { ...KONSOLE, KONSOLE_VERSION: "260801" };

    assert.equal(detect({ ...fromKonsole, TERM_PROGRAM: "vscode" }), "blocks");
    assert.equal(detect({ ...fromKonsole, TERM: "alacritty" }), "blocks");
    assert.equal(detect({ ...fromKonsole, TERM: "xterm-256color" }), "kitty");
    assert.equal(detect({ ...fromKonsole, TERM: "konsole-direct" }), "kitty");
    assert.equal(detect({ ...fromKonsole, TERM_PROGRAM: "Konsole" }), "kitty");
});

test("detectCoverMode shows no cover without true color", () => {
    assert.equal(detect({}, false), "none");
});

test("detectCoverMode lets the configured mode win", () => {
    const kittyTerminal = { TERM: "xterm-kitty" };

    assert.equal(
        detectCoverMode({
            env: kittyTerminal,
            trueColor: true,
            override: "blocks",
        }),
        "blocks"
    );
    assert.equal(
        detectCoverMode({ env: {}, trueColor: false, override: "kitty" }),
        "kitty"
    );
});

test("parseCoverMode accepts the known modes and nothing", () => {
    assert.equal(parseCoverMode(undefined), undefined);
    assert.equal(parseCoverMode(""), undefined);
    assert.equal(parseCoverMode(" Kitty "), "kitty");
    assert.equal(parseCoverMode("blocks"), "blocks");
});

test("parseCoverMode rejects other values", () => {
    assert.throws(
        () => parseCoverMode("sixel"),
        /^Error: SOUNDTAG_COVER must be kitty, blocks or none\.$/
    );
});
