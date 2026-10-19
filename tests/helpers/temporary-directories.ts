import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach } from "node:test";

export function useTemporaryDirectories(prefix: string): () => Promise<string> {
    const directories: string[] = [];

    afterEach(async () => {
        await Promise.all(
            directories
                .splice(0)
                .map((directory) =>
                    fs.rm(directory, { recursive: true, force: true })
                )
        );
    });

    return async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
        directories.push(directory);
        return directory;
    };
}
