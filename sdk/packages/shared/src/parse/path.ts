import path from "node:path";

/**
 * Rewrite the current platform's path separator to `/`.
 *
 * Use it wherever a path leaves the filesystem layer for presentation, storage
 * or comparison: mention pickers, task history shared across OSes, plugin
 * manifests, dedupe keys. It splits on `path.sep` only, so on POSIX a literal
 * backslash in a filename is left alone (`foo\bar.txt` stays `foo\bar.txt`),
 * while on Windows `src\main.ts` becomes `src/main.ts`.
 *
 * This is deliberately not `replace(/\\/g, "/")`: that variant corrupts POSIX
 * filenames containing backslashes. Reach for it only when the input is
 * user-typed and may carry Windows separators on any OS.
 */
export function toPosixSeparators(p: string): string {
	return p.split(path.sep).join("/");
}
