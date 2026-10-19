import * as path from "node:path";
import * as fs from "node:fs/promises";
import { findAudioFiles } from "../library/file.js";
import type { MetadataChain } from "../metadata/metadata-chain.js";
import {
    countStatuses,
    createReport,
    MAX_FILES_PER_RUN,
    processBatch,
} from "../processing/batch.js";
import {
    getReportPath,
    mergeReports,
    readReport,
    saveReport,
} from "../processing/report-file.js";
import type { ProcessedTrack, ProcessingReport } from "../processing/types.js";
import { getErrorMessage } from "../shared/errors.js";
import type { Logger } from "../shared/logger.js";
import type { TagJobRunner, TagTarget } from "./types.js";

export interface TagJobDependencies {
    metadataChain: MetadataChain;
    logger: Logger;
    recursive: boolean;
    renameFiles: boolean;
    onTrackProcessed: (result: ProcessedTrack) => void;
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

const TARGET_FINDERS: Record<
    TagTarget["kind"],
    (
        targetPath: string,
        dependencies: TagJobDependencies
    ) => Promise<TargetFiles>
> = {
    file: (file, { logger }) => findFile(file, logger),
    folder: async (folder, { recursive }) => ({
        sourceRoot: folder,
        files: await findAudioFiles(folder, recursive, MAX_FILES_PER_RUN),
    }),
};

async function saveMergedReport(
    sourceRoot: string,
    report: ProcessingReport,
    logger: Logger
): Promise<boolean> {
    const reportPath = getReportPath(sourceRoot);
    const merged = mergeReports(await readReport(reportPath), report);
    return saveReport(reportPath, merged, logger);
}

async function runBatch(
    { sourceRoot, files }: TargetFiles,
    stopSignal: AbortSignal,
    dependencies: TagJobDependencies
): Promise<ProcessingReport> {
    const { metadataChain, logger, renameFiles, onTrackProcessed } =
        dependencies;
    logger.info(`Tagging ${files.length} audio files in ${sourceRoot}`);
    const report = createReport(files, sourceRoot);
    await processBatch(files, {
        context: { sourceRoot, metadataChain, logger },
        report,
        stopSignal,
        renameFiles,
        onTrackProcessed,
    });
    return report;
}

async function tagFiles(
    targetFiles: TargetFiles,
    stopSignal: AbortSignal,
    dependencies: TagJobDependencies
): Promise<boolean> {
    const report = await runBatch(targetFiles, stopSignal, dependencies);
    const { sourceRoot } = targetFiles;
    const saved = await saveMergedReport(
        sourceRoot,
        report,
        dependencies.logger
    );
    return saved && countStatuses(report).errors === 0;
}

async function tagFoundFiles(
    targetFiles: TargetFiles,
    stopSignal: AbortSignal,
    dependencies: TagJobDependencies
): Promise<boolean> {
    if (targetFiles.files.length > 0) {
        return tagFiles(targetFiles, stopSignal, dependencies);
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
        const targetFiles = await TARGET_FINDERS[target.kind](
            target.path,
            dependencies
        );
        return await tagFoundFiles(targetFiles, stopSignal, dependencies);
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
