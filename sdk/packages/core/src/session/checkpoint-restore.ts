import { execFile as execFileCallback } from "node:child_process";
import {
	chmod,
	lstat,
	mkdir,
	readFile,
	realpath,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type * as LlmsProviders from "@cline/llms";
import type {
	CheckpointEntry,
	CheckpointMetadata,
} from "../hooks/checkpoint-hooks";
import type { SessionRecord } from "../types/sessions";

const execFile = promisify(execFileCallback);

export interface CheckpointRestoreFileResult {
	filePath: string;
	action: "write" | "delete";
	status: "restored" | "rolled-back" | "failed";
	error?: string;
}

export interface CheckpointWorkspaceRestoreResult {
	status: "restored" | "partial";
	checkpoint: CheckpointEntry;
	cwd: string;
	files: CheckpointRestoreFileResult[];
}

export class CheckpointWorkspaceRestoreError extends Error {
	constructor(
		readonly code: "approval_required" | "unsafe_path" | "partial_failure",
		message: string,
		readonly result?: CheckpointWorkspaceRestoreResult,
	) {
		super(message);
		this.name = "CheckpointWorkspaceRestoreError";
	}
}

export interface CheckpointRestorePlan {
	checkpoint: CheckpointEntry;
	messages?: LlmsProviders.Message[];
	cwd: string;
}

export function readSessionCheckpointHistory(
	session: Pick<SessionRecord, "metadata"> | undefined,
): CheckpointEntry[] {
	const checkpoint =
		session?.metadata?.checkpoint &&
		typeof session.metadata.checkpoint === "object" &&
		!Array.isArray(session.metadata.checkpoint)
			? (session.metadata.checkpoint as Record<string, unknown>)
			: undefined;
	const history = Array.isArray(checkpoint?.history) ? checkpoint.history : [];
	return history
		.filter(
			(entry): entry is Record<string, unknown> =>
				!!entry && typeof entry === "object" && !Array.isArray(entry),
		)
		.flatMap((entry): CheckpointEntry[] => {
			const ref = String(entry.ref ?? "").trim();
			const createdAt = Number(entry.createdAt ?? 0);
			const runCount = Number(entry.runCount ?? 0);
			if (
				ref.length === 0 ||
				!Number.isFinite(createdAt) ||
				!Number.isInteger(runCount) ||
				runCount < 1
			) {
				return [];
			}
			const kind =
				entry.kind === "stash" || entry.kind === "commit"
					? entry.kind
					: undefined;
			return [
				{
					ref,
					createdAt,
					runCount,
					...(kind ? { kind } : {}),
					...(entry.schemaVersion === 2 ? { schemaVersion: 2 as const } : {}),
					...(typeof entry.checkpointId === "string"
						? { checkpointId: entry.checkpointId }
						: {}),
					...(typeof entry.sessionId === "string"
						? { sessionId: entry.sessionId }
						: {}),
					...(typeof entry.workspaceRoot === "string"
						? { workspaceRoot: entry.workspaceRoot }
						: {}),
					...(typeof entry.gitBase === "string"
						? { gitBase: entry.gitBase }
						: {}),
					...(typeof entry.gitHead === "string"
						? { gitHead: entry.gitHead }
						: {}),
					...(typeof entry.label === "string" ? { label: entry.label } : {}),
				},
			];
		});
}

export function createRestoredCheckpointMetadata(
	session: Pick<SessionRecord, "metadata"> | undefined,
	runCount: number,
): CheckpointMetadata | undefined {
	const history = readSessionCheckpointHistory(session).filter(
		(entry) => entry.runCount <= runCount,
	);
	const latest = history.at(-1);
	return latest ? { latest, history } : undefined;
}

export function findCheckpointForRun(
	history: readonly CheckpointEntry[],
	runCount: number,
): CheckpointEntry | undefined {
	return history.reduce<CheckpointEntry | undefined>((best, entry) => {
		if (entry.runCount > runCount) {
			return best;
		}
		if (!best || entry.runCount > best.runCount) {
			return entry;
		}
		return best;
	}, undefined);
}

function findCheckpointMessageIndex(
	messages: LlmsProviders.Message[],
	runCount: number,
): number {
	let userRunCount = 0;
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (message?.role !== "user") {
			continue;
		}
		const metadata =
			"metadata" in message &&
			message.metadata &&
			typeof message.metadata === "object"
				? (message.metadata as Record<string, unknown>)
				: undefined;
		if (metadata?.kind === "recovery_notice") {
			continue;
		}
		userRunCount += 1;
		if (userRunCount === runCount) {
			return index;
		}
	}
	throw new Error(`Could not find user message for checkpoint run ${runCount}`);
}

export function trimMessagesToCheckpoint(
	messages: LlmsProviders.Message[],
	runCount: number,
): LlmsProviders.Message[] {
	const index = findCheckpointMessageIndex(messages, runCount);
	return messages.slice(0, index + 1);
}

export function trimMessagesBeforeCheckpoint(
	messages: LlmsProviders.Message[],
	runCount: number,
): LlmsProviders.Message[] {
	const index = findCheckpointMessageIndex(messages, runCount);
	return messages.slice(0, index);
}

export function createCheckpointRestorePlan(input: {
	session: SessionRecord;
	messages?: LlmsProviders.Message[];
	checkpointRunCount: number;
	cwd?: string;
	restoreMessages?: boolean;
}): CheckpointRestorePlan {
	const runCount = input.checkpointRunCount;
	if (!Number.isInteger(runCount) || runCount < 1) {
		throw new Error("checkpointRunCount must be a positive integer");
	}
	const checkpoint = findCheckpointForRun(
		readSessionCheckpointHistory(input.session),
		runCount,
	);
	if (!checkpoint) {
		throw new Error(
			`No checkpoint found at or before run ${runCount} in session ${input.session.sessionId}`,
		);
	}
	const cwd = (
		input.cwd?.trim() ||
		input.session.cwd ||
		input.session.workspaceRoot
	).trim();
	if (!cwd) {
		throw new Error("cwd or workspaceRoot is required to restore a checkpoint");
	}
	return {
		checkpoint,
		cwd,
		...(input.restoreMessages !== false
			? {
					messages: trimMessagesToCheckpoint(input.messages ?? [], runCount),
				}
			: {}),
	};
}

function isPathWithinWorkspace(root: string, candidate: string): boolean {
	const relative = path.relative(root, candidate);
	return (
		relative === "" ||
		(!relative.startsWith("..") && !path.isAbsolute(relative))
	);
}

function unsafePath(relativePath: string, reason: string): never {
	throw new CheckpointWorkspaceRestoreError(
		"unsafe_path",
		`Checkpoint path is unsafe (${reason}): ${relativePath}`,
	);
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error as NodeJS.ErrnoException).code === code
	);
}

function resolveWorkspacePath(root: string, relativePath: string): string {
	const resolved = path.resolve(root, relativePath);
	const relative = path.relative(root, resolved);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		unsafePath(relativePath, "path escapes the workspace");
	}
	return resolved;
}

async function lstatIfExists(filePath: string) {
	try {
		return await lstat(filePath);
	} catch (error) {
		if (isNodeErrorWithCode(error, "ENOENT")) {
			return undefined;
		}
		throw error;
	}
}

async function validateParentPath(
	root: string,
	filePath: string,
	relativePath: string,
	createMissing = false,
): Promise<void> {
	const parentRelative = path.relative(root, path.dirname(filePath));
	if (parentRelative.startsWith("..") || path.isAbsolute(parentRelative)) {
		unsafePath(relativePath, "parent escapes the workspace");
	}

	let current = root;
	for (const segment of parentRelative.split(path.sep).filter(Boolean)) {
		current = path.join(current, segment);
		let stat = await lstatIfExists(current);
		if (!stat) {
			if (!createMissing) {
				return;
			}
			try {
				await mkdir(current);
			} catch (error) {
				if (!isNodeErrorWithCode(error, "EEXIST")) {
					throw error;
				}
			}
			stat = await lstat(current);
		}
		if (stat.isSymbolicLink()) {
			unsafePath(relativePath, `parent is a symlink: ${segment}`);
		}
		if (!stat.isDirectory()) {
			unsafePath(relativePath, `parent is not a directory: ${segment}`);
		}
		const resolvedParent = await realpath(current);
		if (!isPathWithinWorkspace(root, resolvedParent)) {
			unsafePath(
				relativePath,
				`parent resolves outside the workspace: ${segment}`,
			);
		}
	}
}

async function gitBuffer(cwd: string, args: string[]): Promise<Buffer> {
	const result = await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
		encoding: "buffer",
		maxBuffer: 50 * 1024 * 1024,
	});
	return Buffer.from(result.stdout);
}

async function checkpointPaths(cwd: string, ref: string): Promise<string[]> {
	const [tracked, untracked] = await Promise.all([
		gitBuffer(cwd, ["diff", "--name-only", "-z", ref, "--"]),
		gitBuffer(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
	]);
	return [
		...new Set(
			Buffer.concat([tracked, untracked])
				.toString("utf8")
				.split("\0")
				.filter(Boolean),
		),
	].sort((left, right) => left.localeCompare(right));
}

async function readCheckpointBlob(
	cwd: string,
	ref: string,
	relativePath: string,
): Promise<{ content?: Buffer; executable: boolean }> {
	const treeLine = await execFile(
		"git",
		["-C", cwd, "ls-tree", ref, "--", relativePath],
		{ windowsHide: true, encoding: "utf8" },
	).then((result) => result.stdout.trim());
	if (!treeLine) {
		return { executable: false };
	}
	const mode = treeLine.split(/\s+/, 1)[0];
	if (mode === "120000" || mode === "160000") {
		throw new CheckpointWorkspaceRestoreError(
			"unsafe_path",
			`Checkpoint restore does not overwrite symlinks or submodules: ${relativePath}`,
		);
	}
	return {
		content: await gitBuffer(cwd, ["show", `${ref}:${relativePath}`]),
		executable: mode === "100755",
	};
}

async function writeAtomically(
	root: string,
	filePath: string,
	relativePath: string,
	content: Buffer,
): Promise<void> {
	await validateParentPath(root, filePath, relativePath, true);
	const temporaryPath = `${filePath}.cline-restore-${process.pid}-${Date.now()}`;
	await writeFile(temporaryPath, content);
	await rename(temporaryPath, filePath).catch(async (error) => {
		await rm(temporaryPath, { force: true }).catch(() => {});
		throw error;
	});
}

export async function applyCheckpointToWorktree(
	cwd: string,
	checkpoint: CheckpointEntry,
	options: { approved?: boolean } = {},
): Promise<CheckpointWorkspaceRestoreResult> {
	if (options.approved !== true) {
		throw new CheckpointWorkspaceRestoreError(
			"approval_required",
			"Checkpoint workspace restore requires explicit approval",
		);
	}
	const check = await execFile(
		"git",
		["-C", cwd, "rev-parse", "--is-inside-work-tree"],
		{ windowsHide: true },
	);
	if (check.stdout.trim() !== "true") {
		throw new Error(`${cwd} is not a git repository`);
	}
	await execFile(
		"git",
		["-C", cwd, "cat-file", "-e", `${checkpoint.ref}^{commit}`],
		{ windowsHide: true },
	);
	const workspaceRoot = await realpath(path.resolve(cwd));
	const paths = await checkpointPaths(cwd, checkpoint.ref);
	const snapshots = new Map<
		string,
		{ existed: boolean; content?: Buffer; mode?: number }
	>();
	const files: CheckpointRestoreFileResult[] = [];
	const applied: Array<{ filePath: string; relativePath: string }> = [];

	try {
		for (const relativePath of paths) {
			const filePath = resolveWorkspacePath(workspaceRoot, relativePath);
			await validateParentPath(workspaceRoot, filePath, relativePath);
			const stat = await lstatIfExists(filePath);
			if (stat?.isDirectory() || stat?.isSymbolicLink()) {
				throw new CheckpointWorkspaceRestoreError(
					"unsafe_path",
					`Checkpoint restore cannot safely replace ${stat.isDirectory() ? "a directory" : "a symlink"}: ${relativePath}`,
				);
			}
			snapshots.set(filePath, {
				existed: Boolean(stat),
				...(stat ? { content: await readFile(filePath), mode: stat.mode } : {}),
			});
			const checkpointBlob = await readCheckpointBlob(
				cwd,
				checkpoint.ref,
				relativePath,
			);
			const fileResult: CheckpointRestoreFileResult = {
				filePath,
				action: checkpointBlob.content ? "write" : "delete",
				status: "restored",
			};
			files.push(fileResult);
			applied.push({ filePath, relativePath });
			if (checkpointBlob.content) {
				await writeAtomically(
					workspaceRoot,
					filePath,
					relativePath,
					checkpointBlob.content,
				);
				if (process.platform !== "win32") {
					await chmod(filePath, checkpointBlob.executable ? 0o755 : 0o644);
				}
			} else {
				await rm(filePath, { force: true });
			}
		}
		return { status: "restored", checkpoint, cwd, files };
	} catch (error) {
		let rollbackFailed = false;
		for (const { filePath, relativePath } of [...applied].reverse()) {
			const snapshot = snapshots.get(filePath);
			try {
				if (snapshot?.existed && snapshot.content) {
					await writeAtomically(
						workspaceRoot,
						filePath,
						relativePath,
						snapshot.content,
					);
					if (process.platform !== "win32" && snapshot.mode !== undefined) {
						await chmod(filePath, snapshot.mode);
					}
				} else {
					await rm(filePath, { force: true });
				}
				const result = files.find(
					(candidate) => candidate.filePath === filePath,
				);
				if (result) result.status = "rolled-back";
			} catch (rollbackError) {
				rollbackFailed = true;
				const result = files.find(
					(candidate) => candidate.filePath === filePath,
				);
				if (result) {
					result.status = "failed";
					result.error =
						rollbackError instanceof Error
							? rollbackError.message
							: String(rollbackError);
				}
			}
		}
		const result: CheckpointWorkspaceRestoreResult = {
			status: "partial",
			checkpoint,
			cwd,
			files,
		};
		throw new CheckpointWorkspaceRestoreError(
			"partial_failure",
			`${rollbackFailed ? "Checkpoint restore partially failed" : "Checkpoint restore failed and was rolled back"}: ${error instanceof Error ? error.message : String(error)}`,
			result,
		);
	}
}
