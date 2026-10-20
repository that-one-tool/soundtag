export type CoverMode = "kitty" | "blocks" | "none";

const COVER_MODES: readonly string[] = ["kitty", "blocks", "none"];

// Konsole 22.04 added the kitty graphics protocol.
const KONSOLE_KITTY_VERSION = 220400;

const KONSOLE_PROGRAMS = new Set(["", "konsole"]);
const KONSOLE_TERMS = /^(xterm-256color|konsole)/;
const MULTIPLEXER_VARIABLES = ["TMUX", "STY", "ZELLIJ"];

// Terminals started from Konsole inherit KONSOLE_VERSION but name themselves
// through TERM_PROGRAM or TERM.
function isKonsoleProgram(env: NodeJS.ProcessEnv): boolean {
    return KONSOLE_PROGRAMS.has((env.TERM_PROGRAM ?? "").toLowerCase());
}

function isKonsoleTerminal(env: NodeJS.ProcessEnv): boolean {
    return isKonsoleProgram(env) && KONSOLE_TERMS.test(env.TERM ?? "");
}

function isKonsoleWithKittyGraphics(env: NodeJS.ProcessEnv): boolean {
    return (
        isKonsoleTerminal(env) &&
        Number(env.KONSOLE_VERSION) >= KONSOLE_KITTY_VERSION
    );
}

const KITTY_TERMINALS: ((env: NodeJS.ProcessEnv) => boolean)[] = [
    isKonsoleWithKittyGraphics,
    (env) => env.TERM === "xterm-kitty",
    (env) => env.TERM_PROGRAM === "ghostty",
];

// Multiplexers do not pass graphics through unless configured to.
function isMultiplexed(env: NodeJS.ProcessEnv): boolean {
    return MULTIPLEXER_VARIABLES.some((name) => env[name] !== undefined);
}

function supportsKittyGraphics(env: NodeJS.ProcessEnv): boolean {
    return (
        !isMultiplexed(env) && KITTY_TERMINALS.some((supports) => supports(env))
    );
}

function getDetectedMode(env: NodeJS.ProcessEnv, trueColor: boolean) {
    if (supportsKittyGraphics(env)) {
        return "kitty";
    }

    return trueColor ? "blocks" : "none";
}

export interface CoverTerminal {
    env: NodeJS.ProcessEnv;
    trueColor: boolean;
    override?: CoverMode;
}

export function detectCoverMode({
    env,
    trueColor,
    override,
}: CoverTerminal): CoverMode {
    return override ?? getDetectedMode(env, trueColor);
}

function isCoverMode(value: string): value is CoverMode {
    return COVER_MODES.includes(value);
}

function normalizeMode(value: string | undefined): string {
    return (value ?? "").trim().toLowerCase();
}

export function parseCoverMode(
    value: string | undefined
): CoverMode | undefined {
    const mode = normalizeMode(value);

    if (!mode) {
        return undefined;
    }

    if (!isCoverMode(mode)) {
        throw new Error("SOUNDTAG_COVER must be kitty, blocks or none.");
    }

    return mode;
}
