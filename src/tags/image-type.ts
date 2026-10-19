interface BytePattern {
    offset: number;
    bytes: number[];
}

interface ImageSignature {
    mimeType: string;
    patterns: BytePattern[];
}

const DEFAULT_MIME_TYPE = "image/jpeg";
const IMAGE_SIGNATURES: ImageSignature[] = [
    {
        mimeType: "image/jpeg",
        patterns: [{ offset: 0, bytes: [0xff, 0xd8, 0xff] }],
    },
    {
        mimeType: "image/png",
        patterns: [{ offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47] }],
    },
    {
        mimeType: "image/gif",
        patterns: [{ offset: 0, bytes: [0x47, 0x49, 0x46, 0x38] }],
    },
    {
        mimeType: "image/webp",
        patterns: [
            { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
            { offset: 8, bytes: [0x57, 0x45, 0x42, 0x50] },
        ],
    },
];

function matchesPattern(data: Buffer, pattern: BytePattern): boolean {
    return pattern.bytes.every(
        (byte, index) => data[pattern.offset + index] === byte
    );
}

export function getImageMimeType(data: Buffer): string {
    const signature = IMAGE_SIGNATURES.find(({ patterns }) =>
        patterns.every((pattern) => matchesPattern(data, pattern))
    );
    return signature?.mimeType ?? DEFAULT_MIME_TYPE;
}
