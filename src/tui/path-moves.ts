import type { PathMove } from "../shared/paths.js";

type MoveListener = (move: PathMove) => void;

export class PathMoves {
    private readonly listeners = new Set<MoveListener>();

    subscribe = (listener: MoveListener): (() => void) => {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    };

    record(move: PathMove): void {
        for (const listener of this.listeners) {
            listener(move);
        }
    }
}
