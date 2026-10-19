import * as path from "node:path";
import { getErrorMessage } from "./errors.js";
import { inferFolderSearchTerms } from "./folder-context.js";
import { parseTrackFilename } from "./track-name-parser.js";
import { getTagStore, isProperlyTagged } from "./audio-tags.js";
import type { MetadataChain } from "./metadata-chain.js";
import type { ProcessingReport, ProcessingStats } from "./types.js";

export async function processTrack(
    source: string,
    sourceRoot: string,
    metadataChain: MetadataChain,
    stats: ProcessingStats,
    report: ProcessingReport,
    index: number,
    total: number
): Promise<void> {
    const relativePath = path.relative(sourceRoot, source);
    const filenameTerms = parseTrackFilename(path.basename(source));
    const folderTerms = inferFolderSearchTerms(source, sourceRoot);
    const extension = path.extname(source);

    report.files[relativePath] = "READ";
    console.log(`\n[${index}/${total}] ${relativePath}`);
    console.log(`Format: ${extension.slice(1).toUpperCase()}`);

    try {
        const tagStore = getTagStore(source);
        const storedTags = await tagStore.read(source);

        if (isProperlyTagged(storedTags)) {
            console.log("Already properly tagged. Skipping.");
            stats.skipped++;
            report.files[relativePath] = "SKIPPED";
            return;
        }

        const existingInfo = storedTags.info;
        const artist =
            existingInfo.artist ||
            filenameTerms.artist ||
            folderTerms.artist ||
            "";
        const title = existingInfo.title || filenameTerms.title;
        const album = existingInfo.album || folderTerms.album || "";

        console.log(
            `Searching: "${title}"${artist ? ` (artist: "${artist}")` : ""}${album ? ` (album: "${album}")` : ""}`
        );

        const metadata = await metadataChain.find(
            { title, artist, album },
            existingInfo
        );

        if (!metadata) {
            console.log(
                "Track not found on available metadata services. Leaving source unchanged."
            );
            stats.skipped++;
            report.files[relativePath] = "SKIPPED";
            return;
        }

        if (!metadata.info.title.trim() || !metadata.info.artist.trim()) {
            console.log(
                "Track title or artist is missing. Leaving source unchanged."
            );
            stats.skipped++;
            report.files[relativePath] = "SKIPPED";
            return;
        }

        const missingFields = [
            !metadata.info.album.trim() && "album",
            !metadata.info.year.trim() && "year",
            !metadata.coverData && "cover art",
        ].filter((field): field is string => Boolean(field));

        if (missingFields.length > 0) {
            console.log(
                `Some metadata was unavailable (${missingFields.join(", ")}); saving the fields that were found.`
            );
        }

        await tagStore.write(source, metadata);

        console.log("Successfully tagged source file.");
        stats.ok++;
        report.files[relativePath] = "TAGGED";
    } catch (error) {
        console.error(`Processing error: ${getErrorMessage(error)}`);
        stats.errors++;
        report.files[relativePath] = "FAILED";
    }
}
