import * as path from "node:path";
import { FolderNameCache } from "../library/folder-names.js";
import type { Logger } from "../shared/logger.js";
import { movePath, type PathMove } from "../shared/paths.js";
import { planAlbumFolderNames } from "./album-folder-names.js";
import {
    findFolderAlbum,
    renameAlbumFolder,
    type AlbumFolderRenaming,
} from "./album-folders.js";
import {
    borrowFolderCover,
    FolderCovers,
    type CoverSharing,
} from "./folder-covers.js";
import { processTrack, type ProcessingContext } from "./processing.js";
import { describeCorrection } from "../metadata/track-corrections.js";
import type { TagCorrection } from "../metadata/types.js";
import { isRenamable, renameTrack } from "./rename.js";
import type { StoredTags } from "../tags/types.js";
import type {
    FileStatus,
    FolderAlbum,
    FolderName,
    ProcessedTrack,
    ProcessingTrack,
    ProcessingReport,
    ProcessingStats,
} from "./types.js";

export const MAX_FILES_PER_RUN = 3000;

export function createReport(
    files: string[],
    sourceRoot: string
): ProcessingReport {
    return {
        files: Object.fromEntries(
            files.map((file) => [path.relative(sourceRoot, file), "READ"])
        ),
    };
}

function logTrackHeader(
    position: string,
    source: string,
    logger: Logger
): void {
    logger.info(`\n${position}`);
    logger.info(`Format: ${path.extname(source).slice(1).toUpperCase()}`);
}

export interface BatchRun {
    context: ProcessingContext;
    report: ProcessingReport;
    stopSignal: AbortSignal;
    renameFiles: boolean;
    // Defaults to the source folder; this folder and its parents keep their names.
    libraryRoot?: string;
    onTrackProcessed?: (result: ProcessedTrack) => void;
    onFolderRenamed?: (move: PathMove) => void;
}

interface BatchTrack extends ProcessingTrack {
    destination: string | null;
}

interface TaggedTrack extends BatchTrack {
    tags: StoredTags;
}

function hasTags(track: BatchTrack): track is TaggedTrack {
    return track.tags !== null;
}

function isTrusted(track: BatchTrack): track is TaggedTrack {
    return isRenamable(track.status, track.tags);
}

interface ActiveBatch extends BatchRun {
    folderNames: FolderNameCache;
    processed: BatchTrack[];
}

function getReportPath(file: string, sourceRoot: string): string {
    return path.relative(sourceRoot, file) || ".";
}

function recordRename(
    source: string,
    destination: string,
    run: BatchRun
): void {
    const { sourceRoot } = run.context;
    const renamed = (run.report.renamed ??= {});
    renamed[getReportPath(source, sourceRoot)] = getReportPath(
        destination,
        sourceRoot
    );
}

async function renameProcessedFile(
    track: ProcessingTrack,
    run: ActiveBatch
): Promise<string | null> {
    if (!run.renameFiles) {
        return null;
    }

    const destination = await renameTrack(track, {
        folderNames: run.folderNames,
        logger: run.context.logger,
    });

    if (destination) {
        recordRename(track.source, destination, run);
    }

    return destination;
}

async function processFile(
    source: string,
    position: string,
    run: ActiveBatch
): Promise<void> {
    const relativePath = path.relative(run.context.sourceRoot, source);
    logTrackHeader(`[${position}] ${relativePath}`, source, run.context.logger);
    const { corrections, ...result } = await processTrack(source, run.context);
    const track = { source, ...result };
    run.report.files[relativePath] = track.status;
    recordCorrections(relativePath, corrections, run.report);
    const destination = await renameProcessedFile(track, run);
    run.folderNames.markProcessed(source);
    announceTrack({ ...track, destination }, run);
}

function recordCorrections(
    relativePath: string,
    corrections: TagCorrection[],
    report: ProcessingReport
): void {
    if (corrections.length > 0) {
        const corrected = (report.corrected ??= {});
        corrected[relativePath] = corrections.map(describeCorrection);
    }
}

function announceTrack(track: BatchTrack, run: ActiveBatch): void {
    const { source, status, destination } = track;
    run.processed.push(track);
    run.onTrackProcessed?.({ source, status, destination });
}

async function processFiles(files: string[], run: ActiveBatch): Promise<void> {
    for (const [index, source] of files.entries()) {
        if (run.stopSignal.aborted) {
            run.context.logger.info(
                "Stopped before processing the remaining files."
            );
            return;
        }

        await processFile(source, `${index + 1}/${files.length}`, run);
    }
}

async function renameWithBorrowedCover(
    track: BatchTrack,
    tags: StoredTags,
    run: ActiveBatch
): Promise<string | null> {
    const withCover = { ...tags, hasCover: true };
    // Not found by any service, so it is trusted only once fully tagged.
    const destination = await renameProcessedFile(
        { source: track.source, status: "SKIPPED", tags: withCover },
        run
    );
    track.destination = destination ?? track.destination;
    track.tags = withCover;
    return destination;
}

async function markTaggedByCover(
    track: BatchTrack,
    tags: StoredTags,
    run: ActiveBatch
): Promise<void> {
    const { source, status } = track;
    if (status !== "SKIPPED") {
        return;
    }

    run.report.files[path.relative(run.context.sourceRoot, source)] = "TAGGED";
    const destination = await renameWithBorrowedCover(track, tags, run);
    run.onTrackProcessed?.({ source, status: "TAGGED", destination });
}

function getCurrentPath({ source, destination }: BatchTrack): string {
    return destination ?? source;
}

async function shareFolderCover(
    track: TaggedTrack,
    sharing: CoverSharing,
    run: ActiveBatch
): Promise<void> {
    const { tags } = track;
    if (
        await borrowFolderCover({ path: getCurrentPath(track), tags }, sharing)
    ) {
        await markTaggedByCover(track, tags, run);
    }
}

function getKnownTags(tracks: TaggedTrack[]): Map<string, StoredTags> {
    return new Map(tracks.map((track) => [getCurrentPath(track), track.tags]));
}

function logCoverSharingStart(candidates: BatchTrack[], logger: Logger) {
    if (candidates.length > 0) {
        logger.info("\nSharing covers between tracks of the same album...");
    }
}

async function shareFolderCovers(run: ActiveBatch): Promise<void> {
    const { sourceRoot, logger } = run.context;
    const candidates = run.processed.filter(hasTags);
    const folderCovers = new FolderCovers(getKnownTags(candidates));
    const sharing = { folderCovers, sourceRoot, logger };
    logCoverSharingStart(candidates, logger);

    for (const track of candidates) {
        if (run.stopSignal.aborted) {
            logger.info("Stopped before sharing the remaining covers.");
            return;
        }

        await shareFolderCover(track, sharing, run);
    }
}

async function shareFolderCoversUnlessStopped(run: ActiveBatch): Promise<void> {
    if (!run.stopSignal.aborted) {
        await shareFolderCovers(run);
    }
}

function getTrackFolders(tracks: BatchTrack[]): string[] {
    return [
        ...new Set(tracks.map((track) => path.dirname(getCurrentPath(track)))),
    ];
}

function moveRenamedPath(
    reportPath: string,
    move: PathMove,
    sourceRoot: string
): string {
    const file = path.resolve(sourceRoot, reportPath);
    return getReportPath(movePath(file, move), sourceRoot);
}

// Earlier renames must point at where the files are now.
function moveRenamedPaths(move: PathMove, run: ActiveBatch): void {
    const { report, context } = run;
    const renamed = Object.entries(report.renamed ?? {});
    report.renamed = Object.fromEntries(
        renamed.map(([from, to]) => [
            from,
            moveRenamedPath(to, move, context.sourceRoot),
        ])
    );
}

async function renameFolder(
    target: FolderName,
    renaming: AlbumFolderRenaming,
    run: ActiveBatch
): Promise<void> {
    const move = await renameAlbumFolder(target, renaming);

    if (move) {
        moveRenamedPaths(move, run);
        recordRename(move.source, move.destination, run);
        run.onFolderRenamed?.(move);
    }
}

function createAlbumFolderRenaming(run: ActiveBatch): AlbumFolderRenaming {
    return {
        libraryRoot: run.libraryRoot ?? run.context.sourceRoot,
        knownTags: getKnownTags(run.processed.filter(isTrusted)),
        folderNames: new FolderNameCache([]),
        logger: run.context.logger,
    };
}

async function findFolderAlbums(
    folders: string[],
    renaming: AlbumFolderRenaming
): Promise<FolderAlbum[]> {
    const albums: FolderAlbum[] = [];
    for (const folder of folders) {
        const album = await findFolderAlbum(folder, renaming);
        albums.push(...(album ? [album] : []));
    }
    return albums;
}

async function renameAlbumFolders(run: ActiveBatch): Promise<void> {
    const renaming = createAlbumFolderRenaming(run);
    const folders = getTrackFolders(run.processed);
    const albums = await findFolderAlbums(folders, renaming);

    for (const target of planAlbumFolderNames(albums, renaming.logger)) {
        if (run.stopSignal.aborted) {
            run.context.logger.info(
                "Stopped before renaming the remaining folders."
            );
            return;
        }

        await renameFolder(target, renaming, run);
    }
}

async function renameAlbumFoldersIfAllowed(run: ActiveBatch): Promise<void> {
    if (run.renameFiles && !run.stopSignal.aborted) {
        await renameAlbumFolders(run);
    }
}

function getFixingContext(context: ProcessingContext): ProcessingContext {
    if (!context.corrector || context.corrector.canCorrect()) {
        return context;
    }

    context.logger.info(
        "Fixing tags requires MUSICBRAINZ_USER_AGENT; only missing tags are filled."
    );
    return { ...context, corrector: undefined };
}

export async function processBatch(
    files: string[],
    run: BatchRun
): Promise<void> {
    const folderNames = new FolderNameCache(files);
    const context = getFixingContext(run.context);
    const batch: ActiveBatch = { ...run, context, folderNames, processed: [] };

    try {
        await processFiles(files, batch);
        await shareFolderCoversUnlessStopped(batch);
        await renameAlbumFoldersIfAllowed(batch);
    } finally {
        folderNames.clear();
        run.context.metadataChain.clearCache();
    }
}

export function countStatuses(report: ProcessingReport): ProcessingStats {
    const statuses = Object.values(report.files);
    const count = (status: FileStatus) =>
        statuses.filter((fileStatus) => fileStatus === status).length;

    return {
        ok: count("TAGGED"),
        skipped: count("SKIPPED"),
        errors: count("FAILED"),
        unprocessed: count("READ"),
    };
}
