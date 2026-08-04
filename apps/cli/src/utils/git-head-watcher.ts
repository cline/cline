import { execFile } from "node:child_process";
import { type FSWatcher, watch } from "node:fs";
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

export interface WatchGitHeadOptions {
	debounceMs?: number;
	/** Injectable for tests. Defaults to resolveGitDir. */
	resolveDir?: (cwd: string) => Promise<string | null>;
}

/**
 * Watch for HEAD changes (e.g. branch checkouts made from another terminal or
 * an editor) and invoke `onHeadChange` when they happen. Git replaces HEAD via
 * rename, which silently kills file-level watchers, so we watch the git
 * directory and filter for HEAD events instead.
 *
 * Returns a dispose function. Failures (not a repo, fs.watch unsupported) are
 * swallowed: the caller's periodic fallback polling still applies.
 */
export function watchGitHead(
	cwd: string,
	onHeadChange: () => void,
	options?: WatchGitHeadOptions,
): () => void {
	const debounceMs = options?.debounceMs ?? 100;
	const resolveDir = options?.resolveDir ?? resolveGitDir;
	let watcher: FSWatcher | null = null;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;
	let disposed = false;

	void resolveDir(cwd).then((gitDir) => {
		if (disposed || !gitDir) return;
		try {
			watcher = watch(gitDir, (_eventType, filename) => {
				// filename can be null on some platforms; refresh in that case too.
				if (filename && filename !== "HEAD") return;
				if (debounceTimer) clearTimeout(debounceTimer);
				debounceTimer = setTimeout(() => {
					debounceTimer = null;
					onHeadChange();
				}, debounceMs);
			});
			// Without a listener an errored watcher would crash the process.
			watcher.on("error", () => {});
		} catch {
			watcher = null;
		}
	});

	return () => {
		disposed = true;
		if (debounceTimer) {
			clearTimeout(debounceTimer);
			debounceTimer = null;
		}
		watcher?.close();
		watcher = null;
	};
}
