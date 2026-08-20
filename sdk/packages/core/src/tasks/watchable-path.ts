import { realpathSync } from "node:fs";

/**
 * Resolve a directory to a form that is safe to pass to `fs.watch`.
 *
 * On Windows, watching a path that contains an 8.3 short-name component
 * (for example `C:\Users\RUNNER~1\...`, which is what `os.tmpdir()` returns
 * on GitHub-hosted runners) aborts the entire process when the first event
 * arrives: `ReadDirectoryChangesW` reports long paths, and libuv asserts the
 * watched-directory prefix matches (`src\win\fs-event.c:72`, libuv#5010).
 * The abort is a native assertion, so no `watcher.on("error")` or try/catch
 * can contain it — the path must be normalized before `watch()` is called.
 *
 * POSIX platforms return the path unchanged: `realpath` there also collapses
 * symlinks (`/var` -> `/private/var` on macOS), which would change watcher
 * behavior we don't want to change.
 */
export function toWatchablePath(
	dir: string,
	platform: NodeJS.Platform = process.platform,
): string {
	if (platform !== "win32") return dir;
	try {
		return realpathSync.native(dir);
	} catch {
		return dir;
	}
}
