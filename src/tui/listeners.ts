export class Listeners {
    private readonly listeners = new Set<() => void>();

    add(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    notify(): void {
        for (const listener of this.listeners) {
            listener();
        }
    }
}
