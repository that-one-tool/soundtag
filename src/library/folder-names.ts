function normalizeFilename(name: string): string {
    return name.normalize("NFC").toLowerCase();
}

export function isSameFilename(first: string, second: string): boolean {
    return normalizeFilename(first) === normalizeFilename(second);
}
