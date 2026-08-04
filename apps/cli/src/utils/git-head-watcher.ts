import { execFile } from "node:child_process";
import { type FSWatcher, unwatchFile, watch, watchFile } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Resolve the repository's git directory for `cwd` (handles worktrees and
 * submodules, whose HEAD lives outside `<cwd>/.git`). Returns null when cwd
 * is not inside a git repository or git is unavailable.
 */
export async function resolveGitDir(cwd: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", cwd, "rev-parse", "--absolute-git-dir"],
			{
				encoding: "utf8",
				// Prevent a console window from flashing on Windows.
				windowsHide: true,
			},
		);
		return stdout.trim() || null;
	} catch {
		return null;
	}
}

/** How often the stat-based backstop checks HEAD for changes. */
const HEAD_STAT_POLL_INTERVAL_MS = 2_000;

export interface WatchGitHeadOptions {
	debounceMs?: number;
	/** Injectable for tests. Defaults to resolveGitDir. */
	resolveDir?: (cwd: string) => Promise<string | null>;
}

/**
 * Watch for HEAD changes (e.g. branch checkouts made from another terminal or
 * an editor) and invoke `onHeadChange` when they happen.
 *
 * Two complementary mechanisms are armed:
 *
 * - fs.watch on the git directory, filtered to HEAD events, for instant
 *   notification. Git replaces HEAD via rename, which silently kills
 *   file-level watchers, hence the directory watch. This is unreliable on
 *   some runtime/filesystem combinations (notably Bun on Linux drops the
 *   HEAD rename events, and network mounts may deliver nothing).
 * - fs.watchFile on the HEAD file as a backstop: an in-process stat() every
 *   couple of seconds that only fires when HEAD actually changed. No
 *   subprocesses are spawned unless a change is detected.
 *
 * Both feed a shared debounce. Failures (not a repo, fs.watch unsupported)
 * are swallowed. Returns a dispose function.
 */
export function watchGitHead(
	cwd: string,
	onHeadChange: () => void,
	options?: WatchGitHeadOptions,
): () => void {
	const debounceMs = options?.debounceMs ?? 100;
	const resolveDir = options?.resolveDir ?? resolveGitDir;
	let watcher: FSWatcher | null = null;
	let watchedHeadPath: string | null = null;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	const scheduleChange = () => {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			debounceTimer = null;
			onHeadChange();
		}, debounceMs);
	};

	void resolveDir(cwd).then((gitDir) => {
		if (disposed || !gitDir) return;

		try {
			watcher = watch(gitDir, (_eventType, filename) => {
				// filename can be null on some platforms; refresh in that case too.
				if (filename && filename !== "HEAD") return;
				scheduleChange();
			});
			// Without a listener an errored watcher would crash the process.
			watcher.on("error", () => {});
		} catch {
			watcher = null;
		}

		watchedHeadPath = join(gitDir, "HEAD");
		watchFile(
			watchedHeadPath,
			{ interval: HEAD_STAT_POLL_INTERVAL_MS, persistent: false },
			(curr, prev) => {
				if (curr.mtimeMs !== prev.mtimeMs || curr.ino !== prev.ino) {
					scheduleChange();
				}
			},
		);
	});

	return () => {
		disposed = true;
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		watcher?.close();
		watcher = null;
		if (watchedHeadPath) {
			unwatchFile(watchedHeadPath);
			watchedHeadPath = null;
		}
	};
}
