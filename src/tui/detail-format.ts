const CHANNEL_NAMES: Record<number, string> = { 1: "mono", 2: "stereo" };
const KILOBYTE = 1024;
const MEGABYTE = KILOBYTE * KILOBYTE;

// Tag readers report unknown numbers as 0.
function formatIfKnown(value: number, format: (known: number) => string) {
    return value > 0 ? format(value) : "";
}

export function formatPosition(number: number, count: number): string {
    const total = formatIfKnown(count, (known) => `/${known}`);
    return formatIfKnown(number, (known) => `${known}${total}`);
}

export function formatDisc(number: number, count: number): string {
    return formatIfKnown(number, () => `disc ${formatPosition(number, count)}`);
}

export function joinKnown(parts: string[]): string {
    return parts.filter(Boolean).join(" · ");
}

export function formatDuration(milliseconds: number): string {
    return formatIfKnown(milliseconds, (known) => {
        const totalSeconds = Math.floor(known / 1000);
        const seconds = String(totalSeconds % 60).padStart(2, "0");
        return `${Math.floor(totalSeconds / 60)}:${seconds}`;
    });
}

export function formatBitrate(kbps: number): string {
    return formatIfKnown(kbps, (known) => `${Math.round(known)} kbps`);
}

export function formatSampleRate(hertz: number): string {
    return formatIfKnown(hertz, (known) => `${known / 1000} kHz`);
}

export function formatChannels(channels: number): string {
    return formatIfKnown(
        channels,
        (known) => CHANNEL_NAMES[known] ?? `${known} channels`
    );
}

export function formatFileSize(bytes: number): string {
    if (bytes < MEGABYTE) {
        return `${Math.round(bytes / KILOBYTE)} KB`;
    }

    return `${(bytes / MEGABYTE).toFixed(1)} MB`;
}
