import { execFile as execFileCallback } from "node:child_process";
import {
	mkdir,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
	buildCheckpointWorkspaceDiff,
	type CheckpointEntry,
} from "@cline/core";

const execFile = promisify(execFileCallback);
const MAX_GIT_OUTPUT = 50 * 1024 * 1024;
/** Files above this size ship without contents; the rail shows a notice. */
const MAX_TEXT_BYTES = 1024 * 1024;
/** Whole-file contents ride along with the list, so cap what one call ships. */
const MAX_FILES = 200;

export type WorkspaceChangesScope = "turn" | "session" | "uncommitted";
export type WorkspaceChangeStatus =
	| "added"
	| "modified"
	| "deleted"
	| "renamed";

export interface WorkspaceChangedFile {
	/** Workspace-relative path with forward slashes. */
	path: string;
	status: WorkspaceChangeStatus;
	oldText: string;
	newText: string;
	binary?: boolean;
	/** Set when either side exceeded the transport cap; texts are empty. */
	truncated?: boolean;
}

export interface WorkspaceChangesResult {
	scope: WorkspaceChangesScope;
	/** Repository root that `files[].path` entries are relative to. */
	root?: string;
	files: WorkspaceChangedFile[];
	/** What the working tree is being compared against. */
	base?: { label: string; runCount?: number };
	/** Set when the scope cannot be computed for this workspace. */
	unavailableReason?: string;
	/** Changed files beyond the transport cap that are not in `files`. */
	omittedFiles?: number;
}

export interface WorkspaceDirectoryEntry {
	name: string;
	path: string;
	kind: "file" | "directory";
}

export interface WorkspaceFileContents {
	path: string;
	text: string;
	size: number;
	binary?: boolean;
	truncated?: boolean;
}

async function runGit(
	cwd: string,
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	return await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
		maxBuffer: MAX_GIT_OUTPUT,
		encoding: "utf8",
	});
}

async function gitShowBuffer(
	cwd: string,
	ref: string,
	relativePath: string,
): Promise<Buffer | undefined> {
	try {
		const { stdout } = await execFile(
			"git",
			["-C", cwd, "show", `${ref}:${relativePath}`],
			{ windowsHide: true, maxBuffer: MAX_GIT_OUTPUT, encoding: "buffer" },
		);
		return stdout;
	} catch {
		return undefined;
	}
}

/**
 * Git reports paths relative to the repository root regardless of the
 * directory it runs in, so every read and write below is anchored there.
 * Returns undefined outside a work tree.
 */
async function gitTopLevel(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await runGit(cwd, ["rev-parse", "--show-toplevel"]);
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

function toPosix(path: string): string {
	return path.split(sep).join("/");
}

/**
 * Resolves a workspace-relative (or absolute) path and refuses anything that
 * escapes the workspace root, since these commands read and write files on
 * behalf of the webview.
 */
export function resolveWorkspacePath(cwd: string, path: string): string {
	const absolute = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
	const rel = relative(resolve(cwd), absolute);
	if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
		throw new Error(`Path escapes workspace: ${path}`);
	}
	return absolute;
}

function isBinary(buffer: Buffer): boolean {
	return buffer.subarray(0, 8000).includes(0);
}

function toChangedFile(
	path: string,
	oldBuffer: Buffer | undefined,
	newBuffer: Buffer | undefined,
	status: WorkspaceChangeStatus,
): WorkspaceChangedFile {
	const binary =
		(oldBuffer ? isBinary(oldBuffer) : false) ||
		(newBuffer ? isBinary(newBuffer) : false);
	const truncated =
		(oldBuffer?.length ?? 0) > MAX_TEXT_BYTES ||
		(newBuffer?.length ?? 0) > MAX_TEXT_BYTES;
	const omit = binary || truncated;
	return {
		path,
		status,
		oldText: omit ? "" : (oldBuffer?.toString("utf8") ?? ""),
		newText: omit ? "" : (newBuffer?.toString("utf8") ?? ""),
		...(binary ? { binary: true } : {}),
		...(truncated ? { truncated: true } : {}),
	};
}

function pickCheckpoint(
	checkpoints: readonly CheckpointEntry[],
	scope: "turn" | "session",
): CheckpointEntry | undefined {
	if (checkpoints.length === 0) return undefined;
	return checkpoints.reduce((best, entry) =>
		scope === "turn"
			? entry.runCount > best.runCount
				? entry
				: best
			: entry.runCount < best.runCount
				? entry
				: best,
	);
}

function capFiles(
	files: WorkspaceChangedFile[],
): Pick<WorkspaceChangesResult, "files" | "omittedFiles"> {
	return files.length > MAX_FILES
		? {
				files: files.slice(0, MAX_FILES),
				omittedFiles: files.length - MAX_FILES,
			}
		: { files };
}

async function readUncommittedChanges(
	cwd: string,
): Promise<WorkspaceChangedFile[]> {
	const { stdout } = await runGit(cwd, [
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
		"--no-renames",
	]);
	const records = stdout.split("\0").filter(Boolean);
	const files = await Promise.all(
		records.map(async (record) => {
			const code = record.slice(0, 2);
			const path = record.slice(3);
			const [head, worktree] = await Promise.all([
				gitShowBuffer(cwd, "HEAD", path),
				readFile(resolveWorkspacePath(cwd, path)).catch(() => undefined),
			]);
			const status: WorkspaceChangeStatus =
				code.includes("?") || code.includes("A") || !head
					? "added"
					: !worktree
						? "deleted"
						: "modified";
			return toChangedFile(path, head, worktree, status);
		}),
	);
	return files
		.filter((file) => file.oldText !== file.newText || file.binary)
		.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readWorkspaceChanges(input: {
	cwd: string;
	scope: WorkspaceChangesScope;
	checkpoints?: readonly CheckpointEntry[];
}): Promise<WorkspaceChangesResult> {
	const { scope } = input;
	const root = await gitTopLevel(input.cwd);
	if (!root) {
		return {
			scope,
			files: [],
			unavailableReason: "This workspace is not a git repository.",
		};
	}
	if (scope === "uncommitted") {
		return {
			scope,
			root,
			...capFiles(await readUncommittedChanges(root)),
			base: { label: "HEAD" },
		};
	}
	const checkpoint = pickCheckpoint(input.checkpoints ?? [], scope);
	if (!checkpoint) {
		return {
			scope,
			root,
			files: [],
			unavailableReason:
				"No checkpoint has been recorded for this session yet.",
		};
	}
	let diffs: Awaited<ReturnType<typeof buildCheckpointWorkspaceDiff>>;
	try {
		diffs = await buildCheckpointWorkspaceDiff(root, checkpoint);
	} catch (error) {
		return {
			scope,
			root,
			files: [],
			unavailableReason: `The checkpoint for turn ${checkpoint.runCount} is no longer available (${error instanceof Error ? error.message.split("\n")[0] : String(error)}).`,
		};
	}
	const files = diffs
		.map((diff) => {
			const oldBuffer = Buffer.from(diff.leftContent, "utf8");
			const newBuffer = Buffer.from(diff.rightContent, "utf8");
			const status: WorkspaceChangeStatus =
				diff.leftContent === ""
					? "added"
					: diff.rightContent === ""
						? "deleted"
						: "modified";
			return toChangedFile(
				toPosix(relative(root, diff.filePath)),
				oldBuffer,
				newBuffer,
				status,
			);
		})
		.sort((a, b) => a.path.localeCompare(b.path));
	return {
		scope,
		root,
		...capFiles(files),
		base: {
			label: scope === "turn" ? "start of last turn" : "start of session",
			runCount: checkpoint.runCount,
		},
	};
}

/**
 * Restores one file (a repository-root-relative path from
 * `readWorkspaceChanges`) to its state at the scope's base: the checkpoint
 * tree (or its untracked-files parent) for turn/session scopes, HEAD for
 * uncommitted. Files that did not exist at the base are deleted.
 */
export async function revertWorkspaceChange(input: {
	cwd: string;
	scope: WorkspaceChangesScope;
	path: string;
	checkpoints?: readonly CheckpointEntry[];
}): Promise<{ path: string; action: "restored" | "deleted" }> {
	const { scope } = input;
	const root = await gitTopLevel(input.cwd);
	if (!root) {
		throw new Error("This workspace is not a git repository.");
	}
	const absolute = resolveWorkspacePath(root, input.path);
	const relativePath = toPosix(relative(root, absolute));
	let base: Buffer | undefined;
	if (scope === "uncommitted") {
		base = await gitShowBuffer(root, "HEAD", relativePath);
	} else {
		const checkpoint = pickCheckpoint(input.checkpoints ?? [], scope);
		if (!checkpoint) {
			throw new Error("No checkpoint is available to revert to.");
		}
		base =
			(await gitShowBuffer(root, checkpoint.ref, relativePath)) ??
			(await gitShowBuffer(root, `${checkpoint.ref}^3`, relativePath));
	}
	if (base === undefined) {
		await rm(absolute, { force: true });
		return { path: relativePath, action: "deleted" };
	}
	await mkdir(dirname(absolute), { recursive: true });
	await writeFile(absolute, base);
	return { path: relativePath, action: "restored" };
}

export async function listWorkspaceDirectory(
	cwd: string,
	path = "",
): Promise<{ path: string; entries: WorkspaceDirectoryEntry[] }> {
	const absolute = path ? resolveWorkspacePath(cwd, path) : resolve(cwd);
	const relativeBase = path ? toPosix(relative(cwd, absolute)) : "";
	const dirents = await readdir(absolute, { withFileTypes: true });
	const entries = dirents
		.filter((entry) => entry.name !== ".git")
		.map((entry) => ({
			name: entry.name,
			path: relativeBase ? `${relativeBase}/${entry.name}` : entry.name,
			kind: entry.isDirectory() ? ("directory" as const) : ("file" as const),
		}))
		.sort((a, b) =>
			a.kind === b.kind
				? a.name.localeCompare(b.name)
				: a.kind === "directory"
					? -1
					: 1,
		);
	return { path: relativeBase, entries };
}

export async function readWorkspaceFile(
	cwd: string,
	path: string,
): Promise<WorkspaceFileContents> {
	const absolute = resolveWorkspacePath(cwd, path);
	const relativePath = toPosix(relative(cwd, absolute));
	const info = await stat(absolute);
	if (!info.isFile()) {
		throw new Error(`Not a file: ${relativePath}`);
	}
	if (info.size > MAX_TEXT_BYTES) {
		return { path: relativePath, text: "", size: info.size, truncated: true };
	}
	const buffer = await readFile(absolute);
	if (isBinary(buffer)) {
		return { path: relativePath, text: "", size: info.size, binary: true };
	}
	return { path: relativePath, text: buffer.toString("utf8"), size: info.size };
}
