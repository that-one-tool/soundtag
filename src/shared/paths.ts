import * as path from "node:path";

export interface PathMove {
    source: string;
    destination: string;
}

function isOutside(relative: string): boolean {
    return (
        relative === ".." ||
        relative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relative)
    );
}

function getPathInside(file: string, folder: string): string | null {
    const relative = path.relative(folder, file);
    return isOutside(relative) ? null : relative;
}

export function isInsideFolder(file: string, folder: string): boolean {
    return getPathInside(file, folder) !== null;
}

export function movePath(
    file: string,
    { source, destination }: PathMove
): string {
    const relative = getPathInside(file, source);
    return relative === null ? file : path.join(destination, relative);
}

function getCommonAncestor(first: string, second: string): string {
    let ancestor = first;
    while (!isInsideFolder(second, ancestor) && !isRoot(ancestor)) {
        ancestor = path.dirname(ancestor);
    }
    return ancestor;
}

function isRoot(folder: string): boolean {
    return path.dirname(folder) === folder;
}

export function findCommonFolder(folders: string[]): string {
    return folders.reduce(getCommonAncestor);
}
