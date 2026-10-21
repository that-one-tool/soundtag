export interface Logger {
    info(message: string): void;
    error(message: string): void;
    // A transient status that the next message replaces; empty clears it.
    progress(message: string): void;
}

export interface ProgressTerminal {
    isTTY?: boolean;
    columns?: number;
    write(text: string): boolean;
}

const CLEAR_LINE = "\r\u001b[2K";
const DEFAULT_COLUMNS = 80;

// A wrapped progress line could not be cleared with a single carriage return.
function fitToWidth(message: string, terminal: ProgressTerminal): string {
    return message.slice(0, (terminal.columns ?? DEFAULT_COLUMNS) - 1);
}

class ConsoleLogger implements Logger {
    private isShowingProgress = false;

    constructor(private readonly terminal: ProgressTerminal) {}

    info(message: string): void {
        this.clearProgress();
        console.log(message);
    }

    error(message: string): void {
        this.clearProgress();
        console.error(message);
    }

    progress(message: string): void {
        if (this.terminal.isTTY) {
            this.showProgress(message);
        }
    }

    private showProgress(message: string): void {
        this.clearProgress();
        if (message) {
            this.terminal.write(fitToWidth(message, this.terminal));
            this.isShowingProgress = true;
        }
    }

    private clearProgress(): void {
        if (this.isShowingProgress) {
            this.terminal.write(CLEAR_LINE);
            this.isShowingProgress = false;
        }
    }
}

export function createConsoleLogger(
    terminal: ProgressTerminal = process.stdout
): Logger {
    return new ConsoleLogger(terminal);
}

export const consoleLogger: Logger = createConsoleLogger();
