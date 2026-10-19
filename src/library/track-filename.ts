// oxlint-disable-next-line no-control-regex
const FORBIDDEN_FILENAME_CHARACTERS = /[/\\:*?"<>|\u0000-\u001f]/g;
// Fits ext4's 255-byte and NTFS's 255-unit limits with room to spare.
const MAX_FILENAME_BYTES = 200;

interface TrackName {
    artist: string;
    title: string;
}

function cleanNamePart(value: string): string {
    return value.trim().replace(FORBIDDEN_FILENAME_CHARACTERS, "_");
}

function truncateToBytes(text: string, maxBytes: number): string {
    let truncated = "";

    for (const character of text) {
        if (Buffer.byteLength(truncated + character) > maxBytes) {
            break;
        }

        truncated += character;
    }

    return truncated;
}

export function buildTrackFilename(
    { artist, title }: TrackName,
    extension: string
): string {
    const maxStemBytes = MAX_FILENAME_BYTES - Buffer.byteLength(extension);
    // Capping the artist keeps the title, so long-named artists don't collide.
    const artistPart = truncateToBytes(cleanNamePart(artist), maxStemBytes / 2);
    const stem = `${artistPart.trimEnd()} - ${cleanNamePart(title)}`
        .normalize("NFC")
        .replace(/^\./, "_");
    return `${truncateToBytes(stem, maxStemBytes).trimEnd()}${extension}`;
}
