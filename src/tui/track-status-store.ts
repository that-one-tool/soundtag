import type { ProcessedTrack } from "../processing/types.js";
import { Listeners } from "./listeners.js";
import { recordProcessedTrack } from "./track-statuses.js";
import type { TrackStatuses } from "./types.js";

export class TrackStatusStore {
    private readonly listeners = new Listeners();
    private statuses: TrackStatuses = new Map();

    subscribe = (listener: () => void): (() => void) =>
        this.listeners.add(listener);

    getSnapshot = (): TrackStatuses => this.statuses;

    record(result: ProcessedTrack): void {
        this.statuses = recordProcessedTrack(this.statuses, result);
        this.listeners.notify();
    }
}
