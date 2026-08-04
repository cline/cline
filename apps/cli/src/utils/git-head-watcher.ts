import { execFile } from "node:child_process";
import { unwatchFile, watchFile } from "node:fs";
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

export interface WatchGitHeadOptions {
	intervalMs?: number;
	/** Injectable for tests. Defaults to resolveGitDir. */
	resolveDir?: (cwd: string) => Promise<string | null>;
}

/**
 * Invoke `onHeadChange` when the repository's HEAD changes (e.g. a branch
 * checkout from another terminal or an editor).
 *
 * Uses fs.watchFile — a cheap in-process stat check on the single HEAD file —
 * rather than fs.watch, which misses HEAD's rename-based updates on some
 * runtimes (Bun on Linux) and delivers nothing on network mounts.
 *
 * Returns a dispose function. A non-repo cwd results in a no-op.
 */
export function watchGitHead(
	cwd: string,
	onHeadChange: () => void,
	options?: WatchGitHeadOptions,
): () => void {
	const intervalMs = options?.intervalMs ?? 2_000;
	const resolveDir = options?.resolveDir ?? resolveGitDir;
	let headPath: string | null = null;
	let disposed = false;

	void resolveDir(cwd).then((gitDir) => {
		if (disposed || !gitDir) return;
		headPath = join(gitDir, "HEAD");
		watchFile(
			headPath,
			{ interval: intervalMs, persistent: false },
			(curr, prev) => {
				if (curr.mtimeMs !== prev.mtimeMs || curr.ino !== prev.ino) {
					onHeadChange();
				}
			},
		);
	});

	return () => {
		disposed = true;
		if (headPath) {
			unwatchFile(headPath);
			headPath = null;
		}
	};
}
