import { useSyncExternalStore } from "react";

export interface ExternalStore<Snapshot> {
    subscribe(listener: () => void): () => void;
    getSnapshot(): Snapshot;
}

export function useStore<Snapshot>(store: ExternalStore<Snapshot>): Snapshot {
    return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
