import * as path from "node:path";
import * as fs from "node:fs/promises";
import { findAudioFiles } from "../library/file.js";
import type { AlbumFinder } from "../metadata/album-finder.js";
import type { MetadataChain } from "../metadata/metadata-chain.js";
import type { TrackCorrector } from "../metadata/track-corrector.js";
import {
    countStatuses,
    createReport,
    MAX_FILES_PER_RUN,
    processBatch,
} from "../processing/batch.js";
import type { ProcessingContext } from "../processing/processing.js";
import type { ProcessedTrack, ProcessingReport } from "../processing/types.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import type { PathMove } from "../shared/paths.js";
import type { TagJobRunner, TagJobSettings, TagTarget } from "./types.js";

export interface TagJobDependencies {
    metadataChain: MetadataChain;
    corrector: TrackCorrector;
    albums: AlbumFinder;
    logger: Logger;
    libraryRoot: string;
    onTrackProcessed: (result: ProcessedTrack) => void;
    onFolderRenamed: (move: PathMove) => void;
}

interface TargetFiles {
    sourceRoot: string;
    files: string[];
}

// A queued file may have been renamed by an earlier run in the meantime.
async function findFile(file: string, logger: Logger): Promise<TargetFiles> {
    const exists = await fs.access(file).then(
        () => true,
        () => false
    );

    if (!exists) {
        logger.info(`Skipped: ${file} no longer exists.`);
    }

    return { sourceRoot: path.dirname(file), files: exists ? [file] : [] };
}

async function findFolderFiles(
    folder: string,
    recursive: boolean
): Promise<TargetFiles> {
    return {
        sourceRoot: folder,
        files: await findAudioFiles(folder, recursive, MAX_FILES_PER_RUN),
    };
}

function findTargetFiles(
    target: TagTarget,
    logger: Logger
): Promise<TargetFiles> {
    if (target.kind === "file") {
        return findFile(target.path, logger);
    }

    return findFolderFiles(target.path, target.recursive);
}

interface TagRun {
    stopSignal: AbortSignal;
    settings: TagJobSettings;
}

function buildContext(
    sourceRoot: string,
    settings: TagJobSettings,
    { metadataChain, corrector, albums, logger }: TagJobDependencies
): ProcessingContext {
    const fixing = settings.fixTags ? corrector : undefined;
    const { replaceCovers, coversOnly } = settings;
    return {
        sourceRoot,
        metadataChain,
        logger,
        replaceCovers,
        coversOnly,
        corrector: fixing,
        albums,
    };
}

async function runBatch(
    { sourceRoot, files }: TargetFiles,
    { stopSignal, settings }: TagRun,
    dependencies: TagJobDependencies
): Promise<ProcessingReport> {
    const { logger, libraryRoot, onTrackProcessed, onFolderRenamed } =
        dependencies;
    logger.info(`Tagging ${files.length} audio files in ${sourceRoot}`);
    const report = createReport(files, sourceRoot);
    await processBatch(files, {
        context: buildContext(sourceRoot, settings, dependencies),
        report,
        stopSignal,
        renameFiles: settings.renameFiles,
        libraryRoot,
        onTrackProcessed,
        onFolderRenamed,
    });
    return report;
}

async function tagFiles(
    targetFiles: TargetFiles,
    run: TagRun,
    dependencies: TagJobDependencies
): Promise<boolean> {
    const report = await runBatch(targetFiles, run, dependencies);
    return countStatuses(report).errors === 0;
}

async function tagFoundFiles(
    targetFiles: TargetFiles,
    run: TagRun,
    dependencies: TagJobDependencies
): Promise<boolean> {
    if (targetFiles.files.length > 0) {
        return tagFiles(targetFiles, run, dependencies);
    }

    dependencies.logger.info(
        `No supported audio files found in ${targetFiles.sourceRoot}.`
    );
    return true;
}

async function runTagJob(
    target: TagTarget,
    stopSignal: AbortSignal,
    dependencies: TagJobDependencies
): Promise<boolean> {
    try {
        const targetFiles = await findTargetFiles(target, dependencies.logger);
        const run = { stopSignal, settings: target.settings };
        return await tagFoundFiles(targetFiles, run, dependencies);
    } catch (error) {
        dependencies.logger.error(`Error: ${getErrorMessage(error)}`);
        return false;
    }
}

export function createTagJobRunner(
    dependencies: TagJobDependencies
): TagJobRunner {
    return async (target, stopSignal) => {
        const succeeded = await runTagJob(target, stopSignal, dependencies);
        dependencies.logger.info("Done!");
        return succeeded;
    };
}
