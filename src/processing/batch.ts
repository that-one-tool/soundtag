import * as path from "node:path";
import { planTracks } from "../library/album-plan.js";
import { findAudioFiles } from "../library/file.js";
import type { AlbumTrack, AlbumUnit } from "../library/types.js";
import type { AlbumData, AlbumFinder } from "../metadata/types.js";
import type { Logger } from "../shared/logger.js";
import { tagAlbumTrack, type AlbumSupply } from "./album-tagging.js";
import { processTrack } from "./processing.js";
import type {
    FileStatus,
    ProcessingContext,
    ProcessedTrack,
    ProcessingReport,
    ProcessingStats,
    TrackStatus,
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

export interface BatchRun {
    context: ProcessingContext;
    albums: AlbumFinder;
    report: ProcessingReport;
    stopSignal: AbortSignal;
    onPlanned?: (total: number) => void;
    onTrackProcessed?: (result: ProcessedTrack) => void;
}

interface ActiveBatch extends BatchRun {
    done: number;
    total: number;
}

function listAlbumFiles(folder: string): Promise<string[]> {
    return findAudioFiles(folder, true, MAX_FILES_PER_RUN);
}

function logTrackHeader(source: string, batch: ActiveBatch): void {
    const { sourceRoot, logger } = batch.context;
    const position = `${batch.done + 1}/${batch.total}`;
    const format = path.extname(source).slice(1).toUpperCase();
    const relativePath = path.relative(sourceRoot, source);
    logger.info(`\n[${position}] ${relativePath} (${format})`);
}

function recordTrack(
    source: string,
    status: TrackStatus,
    batch: ActiveBatch
): void {
    const relativePath = path.relative(batch.context.sourceRoot, source);
    batch.report.files[relativePath] = status;
    batch.done += 1;
    batch.onTrackProcessed?.({ source, status });
}

// Logged once: the next file would be the first left out.
function isStopped(batch: ActiveBatch): boolean {
    if (batch.stopSignal.aborted) {
        batch.context.logger.info(
            "Stopped before processing the remaining files."
        );
    }
    return batch.stopSignal.aborted;
}

type TrackTagger = (track: AlbumTrack) => Promise<TrackStatus>;

async function processTracks(
    tracks: AlbumTrack[],
    tagTrack: TrackTagger,
    batch: ActiveBatch
): Promise<boolean> {
    for (const track of tracks) {
        if (isStopped(batch)) {
            return false;
        }

        logTrackHeader(track.path, batch);
        recordTrack(track.path, await tagTrack(track), batch);
    }
    return true;
}

function logAlbumHeader({ folder, tracks }: AlbumUnit, logger: Logger): void {
    logger.info(`\nAlbum ${path.basename(folder)} (${tracks.length} tracks)`);
}

// A sibling disc folder ("Album - CD2") holds one disc, not the whole tracklist.
function getFolderFileCount({ tracks }: AlbumUnit): number | undefined {
    const discs = new Set(tracks.map(({ disc }) => disc));
    return discs.size === 1 && !discs.has(null) ? undefined : tracks.length;
}

function supplyAlbum(unit: AlbumUnit, albums: AlbumFinder): AlbumSupply {
    const search = { artist: unit.artist, album: unit.album };
    let loading: Promise<AlbumData> | undefined;
    return () => (loading ??= albums.resolve(search, getFolderFileCount(unit)));
}

async function processAlbum(
    unit: AlbumUnit,
    batch: ActiveBatch
): Promise<boolean> {
    if (isStopped(batch)) {
        return false;
    }

    const { context } = batch;
    logAlbumHeader(unit, context.logger);
    const getAlbum = supplyAlbum(unit, batch.albums);
    const tagTrack = (track: AlbumTrack) =>
        tagAlbumTrack(track, getAlbum, context);
    return processTracks(unit.tracks, tagTrack, batch);
}

async function processAlbums(
    units: AlbumUnit[],
    batch: ActiveBatch
): Promise<boolean> {
    for (const unit of units) {
        if (!(await processAlbum(unit, batch))) {
            return false;
        }
    }
    return true;
}

function countTracks(units: AlbumUnit[], singles: string[]): number {
    const albumTracks = units.map(({ tracks }) => tracks.length);
    return albumTracks.reduce((sum, count) => sum + count, singles.length);
}

// Files an album brings in count as not processed until they are.
function reportAlbumFiles(units: AlbumUnit[], run: BatchRun): void {
    const { files } = run.report;
    for (const track of units.flatMap(({ tracks }) => tracks)) {
        files[path.relative(run.context.sourceRoot, track.path)] ??= "READ";
    }
}

async function processPlan(files: string[], run: BatchRun): Promise<void> {
    const { albums, singles } = await planTracks(files, listAlbumFiles);
    reportAlbumFiles(albums, run);
    const batch = { ...run, done: 0, total: countTracks(albums, singles) };
    run.onPlanned?.(batch.total);
    const tracks = singles.map((source) => ({ path: source, disc: null }));
    const tagSingle = (track: AlbumTrack) =>
        processTrack(track.path, run.context);

    if (await processAlbums(albums, batch)) {
        await processTracks(tracks, tagSingle, batch);
    }
}

export async function processBatch(
    files: string[],
    run: BatchRun
): Promise<void> {
    try {
        await processPlan(files, run);
    } finally {
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
