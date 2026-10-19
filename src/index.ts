import "dotenv/config";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { stdin as input, stdout as output } from "node:process";
import * as readline from "node:readline/promises";
import { getErrorMessage } from "./errors.js";
import { findAudioFiles, isDirectory } from "./file.js";
import { parseArguments } from "./cli-options.js";
import { createMetadataChain } from "./create-metadata-chain.js";
import { processTrack } from "./processing.js";
import type { ProcessingReport, ProcessingStats } from "./types.js";

const MAX_FILES_PER_RUN = 3000;

async function main(): Promise<void> {
    const report: ProcessingReport = { files: {} };
    let reportPath = path.resolve("soundtag_output.json");
    const terminal = readline.createInterface({
        input,
        output,
    });

    try {
        console.log("========================================");
        console.log("            AUDIO TAGGER");
        console.log("========================================\n");
        console.log(
            "Usage: npm start -- <source-folder> [--recursive | --no-recursive] [-v | --verbose]"
        );

        const options = parseArguments(process.argv.slice(2));
        const apiKey = (
            process.env.LASTFM_API_KEY ??
            (await terminal.question("Enter your Last.fm API key: "))
        ).trim();

        if (!apiKey) {
            throw new Error("A Last.fm API key is required.");
        }

        const metadataChain = createMetadataChain({
            lastFmApiKey: apiKey,
            verbose: options.verbose,
            musicBrainzUserAgent: process.env.MUSICBRAINZ_USER_AGENT,
            youtubeApiKey: process.env.YOUTUBE_API_KEY,
        });

        const sourceInput = (
            options.sourcePath ??
            (await terminal.question("Enter the source folder path: "))
        ).trim();

        if (!sourceInput) {
            throw new Error("A source folder is required.");
        }

        const sourceRoot = path.resolve(sourceInput);

        if (!(await isDirectory(sourceRoot))) {
            throw new Error("The source folder does not exist.");
        }
        reportPath = path.join(sourceRoot, "soundtag_output.json");

        console.log(`\nSource: ${sourceRoot}`);
        console.log("Tagged files will be updated in place.\n");
        console.log(
            `Subfolders: ${options.recursive ? "included" : "excluded"}`
        );
        console.log(`Batch limit: ${MAX_FILES_PER_RUN} audio files per run\n`);

        const audioFiles = await findAudioFiles(
            sourceRoot,
            options.recursive,
            MAX_FILES_PER_RUN
        );

        if (audioFiles.length === 0) {
            console.log("No supported audio files found in the source folder.");
            return;
        }

        console.log(
            `Processing ${audioFiles.length} audio files. Starting tagging...\n`
        );

        for (const file of audioFiles) {
            report.files[path.relative(sourceRoot, file)] = "READ";
        }

        const stats: ProcessingStats = {
            ok: 0,
            skipped: 0,
            errors: 0,
        };

        for (let i = 0; i < audioFiles.length; i++) {
            await processTrack(
                audioFiles[i],
                sourceRoot,
                metadataChain,
                stats,
                report,
                i + 1,
                audioFiles.length
            );
        }

        console.log("\n========================================");
        console.log("PROCESSING COMPLETE");
        console.log(`Successful: ${stats.ok}`);
        console.log(`Skipped:    ${stats.skipped}`);
        console.log(`Errors:     ${stats.errors}`);
        console.log(`Report:     ${reportPath}`);
        console.log("========================================");
    } catch (error) {
        console.error(`Error: ${getErrorMessage(error)}`);
        process.exitCode = 1;
    } finally {
        terminal.close();
        try {
            await fs.writeFile(
                reportPath,
                `${JSON.stringify(report, null, 2)}\n`,
                "utf8"
            );
            console.log(`Processing report written to ${reportPath}`);
        } catch (error) {
            console.error(
                `Could not write processing report to ${reportPath}: ${getErrorMessage(error)}`
            );
            process.exitCode = 1;
        }
    }
}

main();
