import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { resolveClineDir } from "@cline/shared/storage";

const execFileAsync = promisify(execFile);

export interface CreateTaskWorktreeResult {
	success: boolean;
	message: string;
	path?: string;
	taskId?: string;
	repoRoot?: string;
}

export function getTaskWorktreesHomePath(): string {
	return path.join(resolveClineDir(), "worktrees");
}

function sanitizeRepoNameForWorktreePath(repoPath: string): string {
	const folder = path.basename(repoPath.replace(/[\\/]+$/g, "")) || "workspace";
	const cleaned = [...folder]
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code >= 32 && code !== 127 && char !== "/" && char !== "\\";
		})
		.join("")
		.trim();
	return cleaned || "workspace";
}

async function checkGitInstalled(): Promise<boolean> {
	try {
		await execFileAsync("git", ["--version"], { windowsHide: true });
		return true;
	} catch {
		return false;
	}
}

async function getGitRootPath(cwd: string): Promise<string | null> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", cwd, "rev-parse", "--show-toplevel"],
			{ windowsHide: true },
		);
		const root = stdout.trim();
		return root || null;
	} catch {
		return null;
	}
}

export async function createTaskWorktree(options: {
	cwd: string;
	taskId?: string;
}): Promise<CreateTaskWorktreeResult> {
	if (!(await checkGitInstalled())) {
		return {
			success: false,
			message: "Git is not installed. --worktree requires git on PATH.",
		};
	}

	const repoRoot = await getGitRootPath(options.cwd);
	if (!repoRoot) {
		return {
			success: false,
			message: `Not a git repository: ${options.cwd}. --worktree requires a git repo.`,
		};
	}

	const taskId = options.taskId?.trim() || randomUUID();
	if (
		taskId.includes("/") ||
		taskId.includes("\\") ||
		taskId.includes("..") ||
		taskId.includes("\0")
	) {
		return { success: false, message: `Invalid worktree id: ${taskId}` };
	}

	const repoName = sanitizeRepoNameForWorktreePath(repoRoot);
	const worktreePath = path.join(getTaskWorktreesHomePath(), taskId, repoName);

	try {
		await mkdir(path.dirname(worktreePath), { recursive: true });
		await execFileAsync(
			"git",
			["-C", repoRoot, "worktree", "add", "--detach", worktreePath, "HEAD"],
			{ windowsHide: true },
		);
		return {
			success: true,
			message: `Worktree created at ${worktreePath}`,
			path: worktreePath,
			taskId,
			repoRoot,
		};
	} catch (error) {
		return {
			success: false,
			message: `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}
