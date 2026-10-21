// Callers namespace their keys, so each key always holds the same value type.
export class BatchCache {
    private readonly entries = new Map<string, Promise<unknown>>();

    getOrLoad<Value>(key: string, load: () => Promise<Value>): Promise<Value> {
        const cached = this.entries.get(key) as Promise<Value> | undefined;
        return cached ?? this.start(key, load);
    }

    clear(): void {
        this.entries.clear();
    }

    private start<Value>(
        key: string,
        load: () => Promise<Value>
    ): Promise<Value> {
        const loading = load();
        this.entries.set(key, loading);
        loading.catch(() => this.forget(key, loading));
        return loading;
    }

    private forget(key: string, loading: Promise<unknown>): void {
        if (this.entries.get(key) === loading) {
            this.entries.delete(key);
        }
    }
}
