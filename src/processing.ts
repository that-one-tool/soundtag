import * as path from "node:path";
import { inferFolderSearchTerms, parseTrackFilename } from "./file.js";
import { readTrackInfo } from "./audio-tags.js";
import { findTrackMetadata, isProperlyTagged, tagAudio } from "./tagger.js";
import type { ProcessingReport, ProcessingStats } from "./types.js";

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export async function processTrack(
    source: string,
    sourceRoot: string,
    apiKey: string,
    stats: ProcessingStats,
    report: ProcessingReport,
    index: number,
    total: number,
    verbose: boolean,
    musicBrainzUserAgent?: string,
    youtubeApiKey?: string
): Promise<void> {
    const relativePath = path.relative(sourceRoot, source);
    const filenameTerms = parseTrackFilename(path.basename(source));
    const folderTerms = inferFolderSearchTerms(source, sourceRoot);
    const extension = path.extname(source);

    report.files[relativePath] = "READ";
    console.log(`\n[${index}/${total}] ${relativePath}`);
    console.log(`Format: ${extension.slice(1).toUpperCase()}`);

    try {
        if (await isProperlyTagged(source)) {
            console.log("Already properly tagged. Skipping.");
            stats.skipped++;
            report.files[relativePath] = "SKIPPED";
            return;
        }

        const existingInfo = await readTrackInfo(source);
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

        const metadata = await findTrackMetadata(
            title,
            apiKey,
            artist,
            verbose,
            musicBrainzUserAgent,
            youtubeApiKey,
            { album, existingInfo }
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

        await tagAudio(source, source, metadata.info, metadata.coverData);

        console.log("Successfully tagged source file.");
        stats.ok++;
        report.files[relativePath] = "TAGGED";
    } catch (error) {
        console.error(`Processing error: ${getErrorMessage(error)}`);
        stats.errors++;
        report.files[relativePath] = "FAILED";
    }
}
