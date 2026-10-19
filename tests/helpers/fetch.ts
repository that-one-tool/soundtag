import { afterEach } from "node:test";

export function restoreFetchAfterEach(): void {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });
}
