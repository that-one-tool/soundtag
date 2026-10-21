import { getErrorMessage, ignoreServiceError } from "./errors.js";
import type { Logger } from "./logger.js";
import type { Clock } from "./rate-limiter.js";

export interface LookupLogSettings {
    logger: Logger;
    clock: Clock;
    verbose: boolean;
}

export interface LookupStep {
    label: string;
    subject?: string;
}

interface OpenStep extends LookupStep {
    calls: string[];
}

interface RunningCall {
    service: string;
    startedAt: number;
    waited: number;
    notes: string[];
}

const LABEL_WIDTH = 6;
const STEP_INDENT = "  ";
const REQUEST_INDENT = " ".repeat(STEP_INDENT.length + LABEL_WIDTH + 1);
const SECRET_PARAMETER = /key|token/iu;
const SERVICE_PREFIX = /^.*request failed: /u;

function describeFailure(error: unknown): string {
    return getErrorMessage(error).replace(SERVICE_PREFIX, "");
}

function formatSeconds(milliseconds: number): string {
    return `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatTime(elapsed: number, waited: number): string {
    const wait = waited > 0 ? ` (+${formatSeconds(waited)} wait)` : "";
    return `${formatSeconds(elapsed - waited)}${wait}`;
}

function countNotes(notes: string[]): string[] {
    const counts = new Map<string, number>();
    for (const note of notes) {
        counts.set(note, (counts.get(note) ?? 0) + 1);
    }
    return Array.from(counts, ([note, count]) =>
        count > 1 ? `${note} ×${count}` : note
    );
}

function formatNotes(notes: string[]): string {
    return notes.length > 0 ? ` (${countNotes(notes).join("; ")})` : "";
}

export function formatLogLine(label: string, text: string): string {
    return `${STEP_INDENT}${label.padEnd(LABEL_WIDTH)} ${text}`.trimEnd();
}

function formatStep({ label, subject, calls }: OpenStep): string {
    const heading = subject ? `${subject}: ` : "";
    return formatLogLine(label, `${heading}${calls.join(" · ")}`);
}

function hideSecrets(url: URL): string {
    const shown = new URL(url);
    const secrets = Array.from(shown.searchParams.keys()).filter((name) =>
        SECRET_PARAMETER.test(name)
    );
    for (const name of secrets) {
        shown.searchParams.set(name, "[REDACTED]");
    }
    return shown.toString().replaceAll("%5BREDACTED%5D", "[REDACTED]");
}

function formatOutcome<T>(found: T | null, describe: (found: T) => string) {
    return found === null ? "no match" : `✓ ${describe(found)}`;
}

const NO_STEP: OpenStep = { label: "", calls: [] };

// One line per step keeps a file's lookups readable; progress shows the call still running.
export class LookupLog {
    private openStep: OpenStep | null = null;
    private running: RunningCall | null = null;
    private progressText = "";

    constructor(private readonly settings: LookupLogSettings) {}

    async step<T>(step: LookupStep, run: () => Promise<T>): Promise<T> {
        const outerStep = this.openStep;
        const opened = { ...step, calls: [] };
        this.openStep = opened;

        try {
            return await run();
        } finally {
            this.openStep = outerStep;
            this.writeStep(opened);
        }
    }

    async call<T>(
        service: string,
        run: () => Promise<T | null>,
        describe: (found: T) => string = () => ""
    ): Promise<T | null> {
        const running = this.startCall(service);

        try {
            const found = await run();
            this.endCall(running, formatOutcome(found, describe));
            return found;
        } catch (error) {
            this.endCall(running, `✗ ${describeFailure(error)}`);
            return ignoreServiceError(error);
        }
    }

    // An arrow, so rate limiters can take it as their wait callback.
    noteWait = (milliseconds: number): void => {
        if (this.running) {
            this.running.waited += milliseconds;
        }
    };

    note(text: string): void {
        this.running?.notes.push(text);
    }

    noteFailure(what: string, error: unknown): void {
        ignoreServiceError(error);
        this.note(`${what} failed: ${describeFailure(error)}`);
    }

    request(url: URL): void {
        if (this.settings.verbose) {
            this.settings.logger.info(`${REQUEST_INDENT}${hideSecrets(url)}`);
            this.settings.logger.progress(this.progressText);
        }
    }

    private startCall(service: string): RunningCall {
        const step = this.openStep ?? NO_STEP;
        const pending = { ...step, calls: [...step.calls, `${service}…`] };
        this.progressText = formatStep(pending);
        this.settings.logger.progress(this.progressText);
        this.running = {
            service,
            startedAt: this.settings.clock.now(),
            waited: 0,
            notes: [],
        };
        return this.running;
    }

    private endCall(running: RunningCall, outcome: string): void {
        const elapsed = this.settings.clock.now() - running.startedAt;
        const result = `${outcome.trimEnd()}${formatNotes(running.notes)}`;
        const time = formatTime(elapsed, running.waited);
        this.running = null;
        this.progressText = "";
        this.recordCall(`${running.service} ${result} ${time}`);
    }

    private recordCall(text: string): void {
        if (this.openStep) {
            this.openStep.calls.push(text);
            return;
        }

        this.writeStep({ ...NO_STEP, calls: [text] });
    }

    private writeStep(step: OpenStep): void {
        if (step.calls.length > 0) {
            this.settings.logger.info(formatStep(step));
        }
    }
}
