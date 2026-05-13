import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir } from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { resolveClineDir } from "@cline/shared/storage";

const execFileAsync = promisify(execFile);
const TASK_ID_LENGTH = 5;

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

function getWorkspaceFolderLabelForWorktreePath(repoPath: string): string {
	const folder = path.basename(repoPath.replace(/[\\/]+$/g, "")) || "workspace";
	const cleaned = [...folder]
		.filter((char) => {
			const code = char.charCodeAt(0);
			return code >= 32 && code !== 127;
		})
		.join("")
		.trim();
	return cleaned || "workspace";
}

function createShortTaskId(): string {
	return randomUUID().replaceAll("-", "").slice(0, TASK_ID_LENGTH);
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await access(targetPath);
		return true;
	} catch {
		return false;
	}
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

	let taskId = options.taskId?.trim() || createShortTaskId();
	if (
		taskId.includes("/") ||
		taskId.includes("\\") ||
		taskId.includes("..") ||
		taskId.includes("\0")
	) {
		return { success: false, message: `Invalid worktree id: ${taskId}` };
	}

	const workspaceLabel = getWorkspaceFolderLabelForWorktreePath(repoRoot);
	let worktreePath = path.join(
		getTaskWorktreesHomePath(),
		taskId,
		workspaceLabel,
	);
	if (!options.taskId) {
		for (
			let attempt = 0;
			attempt < 16 && (await pathExists(worktreePath));
			attempt += 1
		) {
			taskId = createShortTaskId();
			worktreePath = path.join(
				getTaskWorktreesHomePath(),
				taskId,
				workspaceLabel,
			);
		}
	}

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
