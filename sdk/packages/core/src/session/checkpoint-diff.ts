import { execFile as execFileCallback } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import type { CheckpointEntry } from "../hooks/checkpoint-hooks";
import type { SessionRecord } from "../types/sessions";
import {
	findCheckpointForRun,
	readSessionCheckpointHistory,
} from "./checkpoint-restore";

const execFile = promisify(execFileCallback);
const MAX_GIT_OUTPUT = 50 * 1024 * 1024;
// Diffs are shown as text in the editor. Files larger than this, and files that look
// binary, are reported as changed but are not read into memory: a workspace with build
// output that is not gitignored otherwise pulls gigabytes of blobs into the host (a
// single compare read 1.6 GB through `git cat-file --batch`, and every untracked binary
// was read again with fs.readFile), which killed the extension host with V8 OOM.
export const MAX_TEXT_DIFF_BYTES = 2 * 1024 * 1024;
// Upper bound for one compare call, so many medium files cannot add up either.
export const MAX_TOTAL_DIFF_BYTES = 32 * 1024 * 1024;

export interface CheckpointContentDiff {
	filePath: string;
	leftContent: string;
	rightContent: string;
}

export interface CheckpointComparePlan {
	checkpoint: CheckpointEntry;
	cwd: string;
}

export interface CheckpointWorkspaceCompareResult
	extends CheckpointComparePlan {
	diffs: CheckpointContentDiff[];
}

async function runGit(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
		maxBuffer: MAX_GIT_OUTPUT,
		encoding: "utf8",
	});
	return stdout;
}

function parseNulList(output: string): string[] {
	return output.split("\0").filter(Boolean);
}

function resolveGitPath(cwd: string, relativePath: string): string {
	const absolutePath = path.resolve(cwd, relativePath);
	const relativeFromCwd = path.relative(cwd, absolutePath);
	if (relativeFromCwd.startsWith("..") || path.isAbsolute(relativeFromCwd)) {
		throw new Error(`Checkpoint diff path escapes workspace: ${relativePath}`);
	}
	return absolutePath;
}

async function catFileBatch(
	cwd: string,
	mode: "--batch" | "--batch-check",
	oids: string[],
): Promise<Buffer> {
	const pending = execFile("git", ["-C", cwd, "cat-file", mode], {
		windowsHide: true,
		maxBuffer: Number.POSITIVE_INFINITY,
		encoding: "buffer",
	});
	pending.child.stdin?.end(`${oids.join("\n")}\n`);
	return (await pending).stdout;
}

// Reads all blobs through `git cat-file` batch processes; spawning a git
// process per file floods the host with processes in workspaces with many
// untracked files (e.g. build output that is not gitignored). Blobs over
// MAX_GIT_OUTPUT are skipped and compare as empty.
async function readBlobs(
	cwd: string,
	oids: Iterable<string>,
): Promise<Map<string, string>> {
	const contents = new Map<string, string>();
	const unique = [...new Set(oids)];
	if (unique.length === 0) {
		return contents;
	}
	const sizes = (await catFileBatch(cwd, "--batch-check", unique))
		.toString("utf8")
		.split("\n");
	// Keep only blobs that can be shown as a text diff and stay inside the per-call
	// budget; everything else is reported as changed without content.
	const readable: string[] = [];
	let budget = MAX_TOTAL_DIFF_BYTES;
	for (let index = 0; index < unique.length; index++) {
		const size = Number(sizes[index]?.split(" ")[2]);
		if (!Number.isFinite(size) || size > MAX_TEXT_DIFF_BYTES || size > budget) {
			continue;
		}
		budget -= size;
		readable.push(unique[index]);
	}
	if (readable.length === 0) {
		return contents;
	}
	const stdout = await catFileBatch(cwd, "--batch", readable);
	let offset = 0;
	while (offset < stdout.length) {
		const headerEnd = stdout.indexOf(0x0a, offset);
		const [oid, type, size] = stdout
			.toString("utf8", offset, headerEnd)
			.split(" ");
		offset = headerEnd + 1;
		if (type === "missing") {
			continue;
		}
		const end = offset + Number(size);
		contents.set(oid, stdout.toString("utf8", offset, end));
		offset = end + 1;
	}
	return contents;
}

/**
 * Reads the current worktree version of a path for the text diff.
 * Returns undefined when the file exists but cannot be shown as text (too large or
 * binary), so callers can skip it instead of loading it into the heap.
 */
async function readWorktreeFile(
	cwd: string,
	relativePath: string,
): Promise<string | undefined> {
	const absolutePath = resolveGitPath(cwd, relativePath);
	try {
		const stats = await fs.stat(absolutePath);
		if (!stats.isFile() || stats.size > MAX_TEXT_DIFF_BYTES) {
			return undefined;
		}
		const buffer = await fs.readFile(absolutePath);
		if (looksBinary(buffer)) {
			return undefined;
		}
		return buffer.toString("utf8");
	} catch {
		return "";
	}
}

function looksBinary(buffer: Buffer): boolean {
	const limit = Math.min(buffer.length, 8000);
	for (let index = 0; index < limit; index++) {
		if (buffer[index] === 0) {
			return true;
		}
	}
	return false;
}

async function statFile(
	absolutePath: string,
): Promise<{ size: number; tooLarge: boolean } | undefined> {
	try {
		const stats = await fs.stat(absolutePath);
		if (!stats.isFile()) {
			return undefined;
		}
		return { size: stats.size, tooLarge: stats.size > MAX_TEXT_DIFF_BYTES };
	} catch {
		return undefined;
	}
}

/**
 * Content hash of a worktree file in git's blob format (`sha1("blob <size>\0" + bytes)`),
 * streamed in chunks so a multi-GB file never lands in the heap. The result is directly
 * comparable with the blob id git reports for the checkpoint side.
 */
async function hashWorktreeBlob(
	absolutePath: string,
	size: number,
): Promise<string | undefined> {
	return new Promise((resolve) => {
		const hash = createHash("sha1");
		hash.update(`blob ${size}\0`);
		const stream = createReadStream(absolutePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("error", () => resolve(undefined));
		stream.on("end", () => resolve(hash.digest("hex")));
	});
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}
	if (bytes >= 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}
	return `${bytes} B`;
}

/**
 * A file too large or too binary to render as text still deserves a line in the diff:
 * report its size and content hash on both sides so it is obvious whether it changed,
 * without holding any of its bytes.
 */
function describeUntextualDiff(
	filePath: string,
	checkpointOid: string | undefined,
	worktreeSize: number,
	worktreeHash: string | undefined,
): CheckpointContentDiff {
	const checkpoint = checkpointOid ? `blob ${checkpointOid.slice(0, 12)}` : "absent";
	const worktree = worktreeHash
		? `${formatBytes(worktreeSize)}, blob ${worktreeHash.slice(0, 12)}`
		: `${formatBytes(worktreeSize)}, unreadable`;
	return {
		filePath,
		leftContent: `<binary or large file: ${checkpoint}>`,
		rightContent: `<binary or large file: ${worktree}>`,
	};
}

async function listCheckpointUntrackedBlobs(
	cwd: string,
	ref: string,
): Promise<Map<string, string>> {
	// Untracked-at-snapshot files live in the stash commit's third parent.
	// Plain commit checkpoints (and stashes without untracked files) have no
	// third parent, so treat failure as "none".
	const blobs = new Map<string, string>();
	try {
		const output = await runGit(cwd, ["ls-tree", "-r", "-z", `${ref}^3`]);
		for (const entry of parseNulList(output)) {
			const tab = entry.indexOf("\t");
			const [, type, oid] = entry.slice(0, tab).split(" ");
			if (type === "blob") {
				blobs.set(entry.slice(tab + 1), oid);
			}
		}
	} catch {}
	return blobs;
}

// Maps each tracked path that differs from the checkpoint to its blob in the
// checkpoint tree, or undefined when the checkpoint has no blob there.
async function listTrackedChanges(
	cwd: string,
	ref: string,
): Promise<Map<string, string | undefined>> {
	const output = await runGit(cwd, [
		"diff",
		"--raw",
		"-z",
		"--no-abbrev",
		"--no-renames",
		ref,
		"--",
	]);
	const changes = new Map<string, string | undefined>();
	const fields = parseNulList(output);
	for (let index = 0; index + 1 < fields.length; index += 2) {
		const [oldMode, , oldOid] = fields[index].slice(1).split(" ");
		const hasBlob = oldMode !== "000000" && oldMode !== "160000";
		changes.set(fields[index + 1], hasBlob ? oldOid : undefined);
	}
	return changes;
}

export function createCheckpointComparePlan(input: {
	session: SessionRecord;
	checkpointRunCount: number;
	cwd?: string;
}): CheckpointComparePlan {
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
		throw new Error("cwd or workspaceRoot is required to compare a checkpoint");
	}
	return { checkpoint, cwd };
}

export async function buildCheckpointWorkspaceDiff(
	cwd: string,
	checkpoint: CheckpointEntry,
): Promise<CheckpointContentDiff[]> {
	const { ref } = checkpoint;
	await runGit(cwd, ["cat-file", "-e", `${ref}^{tree}`]);
	const [trackedChanges, untrackedOutput, checkpointUntracked] =
		await Promise.all([
			listTrackedChanges(cwd, ref),
			runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
			listCheckpointUntrackedBlobs(cwd, ref),
		]);
	const changedPaths = [
		...new Set([
			...trackedChanges.keys(),
			...parseNulList(untrackedOutput),
			// Include files untracked at snapshot time so ones deleted since then
			// still show up; unchanged ones are filtered out by content equality.
			...checkpointUntracked.keys(),
		]),
	].sort((a, b) => a.localeCompare(b));
	const checkpointOids = new Map<string, string>();
	for (const relativePath of changedPaths) {
		// Stash-shaped checkpoints keep files that were untracked at snapshot
		// time in a third-parent commit (see createWorktreeStashCommit), not in
		// the stash commit's own tree. Fall back to it so pre-existing
		// untracked files don't falsely appear as newly added.
		const oid =
			trackedChanges.get(relativePath) ?? checkpointUntracked.get(relativePath);
		if (oid) {
			checkpointOids.set(relativePath, oid);
		}
	}
	const checkpointContents = await readBlobs(cwd, checkpointOids.values());
	const diffs = await Promise.all(
		changedPaths.map(async (relativePath): Promise<CheckpointContentDiff | undefined> => {
			const absolutePath = resolveGitPath(cwd, relativePath);
			const oid = checkpointOids.get(relativePath);
			const rightContent = await readWorktreeFile(cwd, relativePath);
			if (rightContent === undefined) {
				// Binary or too large to render as text: report its size and content hash
				// instead of its bytes, so the change stays visible without loading it.
				const stats = await statFile(absolutePath);
				const worktreeHash = stats ? await hashWorktreeBlob(absolutePath, stats.size) : undefined;
				if (worktreeHash && oid && worktreeHash === oid) {
					return undefined;
				}
				return describeUntextualDiff(absolutePath, oid, stats?.size ?? 0, worktreeHash);
			}
			return {
				filePath: absolutePath,
				leftContent: (oid && checkpointContents.get(oid)) ?? "",
				rightContent,
			};
		}),
	);
	return diffs.filter(
		(diff): diff is CheckpointContentDiff =>
			diff !== undefined && diff.leftContent !== diff.rightContent,
	);
}

export async function compareCheckpointToWorkspace(input: {
	session: SessionRecord;
	checkpointRunCount: number;
	cwd?: string;
}): Promise<CheckpointWorkspaceCompareResult> {
	const plan = createCheckpointComparePlan(input);
	const diffs = await buildCheckpointWorkspaceDiff(plan.cwd, plan.checkpoint);
	return { ...plan, diffs };
}
