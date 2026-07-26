import { execFile as execFileCallback } from "node:child_process";
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

export interface CheckpointContentDiff {
	filePath: string;
	previousFilePath?: string;
	status: "added" | "modified" | "deleted" | "renamed";
	leftContent: string;
	rightContent: string;
	restorable: boolean;
	unsafeReason?: string;
}

export interface CheckpointComparePlan {
	checkpoint: CheckpointEntry;
	cwd: string;
}

export interface CheckpointWorkspaceCompareResult
	extends CheckpointComparePlan {
	diffs: CheckpointContentDiff[];
	diverged: boolean;
	restoreRequiresApproval: true;
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

async function readCheckpointFile(
	cwd: string,
	ref: string,
	relativePath: string,
): Promise<string> {
	try {
		return await runGit(cwd, ["show", `${ref}:${relativePath}`]);
	} catch {
		return "";
	}
}

async function readWorktreeFile(
	cwd: string,
	relativePath: string,
): Promise<string> {
	try {
		return await fs.readFile(resolveGitPath(cwd, relativePath), "utf8");
	} catch {
		return "";
	}
}

async function listChangedPaths(
	cwd: string,
	checkpoint: CheckpointEntry,
): Promise<Array<{
	path: string;
	previousPath?: string;
	status: CheckpointContentDiff["status"];
}>> {
	await runGit(cwd, ["cat-file", "-e", `${checkpoint.ref}^{tree}`]);
	const [trackedOutput, untrackedOutput] = await Promise.all([
		runGit(cwd, ["diff", "--name-status", "-z", "-M", checkpoint.ref, "--"]),
		runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
	]);
	const tokens = parseNulList(trackedOutput);
	const changed: Array<{
		path: string;
		previousPath?: string;
		status: CheckpointContentDiff["status"];
	}> = [];
	for (let index = 0; index < tokens.length;) {
		const code = tokens[index++] ?? "";
		const firstPath = tokens[index++] ?? "";
		if (!firstPath) continue;
		if (code.startsWith("R")) {
			const nextPath = tokens[index++] ?? "";
			if (nextPath) {
				changed.push({
					path: nextPath,
					previousPath: firstPath,
					status: "renamed",
				});
			}
			continue;
		}
		changed.push({
			path: firstPath,
			status:
				code.startsWith("A")
					? "added"
					: code.startsWith("D")
						? "deleted"
						: "modified",
		});
	}
	const known = new Set(changed.map((entry) => entry.path));
	for (const untrackedPath of parseNulList(untrackedOutput)) {
		if (!known.has(untrackedPath)) {
			changed.push({ path: untrackedPath, status: "added" });
		}
	}
	return changed.sort((a, b) => a.path.localeCompare(b.path));
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
	const changedPaths = await listChangedPaths(cwd, checkpoint);
	const diffs = await Promise.all(
		changedPaths.map(async (change) => {
			const checkpointPath = change.previousPath ?? change.path;
			const [leftContent, rightContent] = await Promise.all([
				readCheckpointFile(cwd, checkpoint.ref, checkpointPath),
				readWorktreeFile(cwd, change.path),
			]);
			return {
				filePath: resolveGitPath(cwd, change.path),
				...(change.previousPath
					? { previousFilePath: resolveGitPath(cwd, change.previousPath) }
					: {}),
				status: change.status,
				leftContent,
				rightContent,
				restorable: true,
			};
		}),
	);
	return diffs.filter(
		(diff) =>
			diff.status === "renamed" || diff.leftContent !== diff.rightContent,
	);
}

export async function compareCheckpointToWorkspace(input: {
	session: SessionRecord;
	checkpointRunCount: number;
	cwd?: string;
}): Promise<CheckpointWorkspaceCompareResult> {
	const plan = createCheckpointComparePlan(input);
	const diffs = await buildCheckpointWorkspaceDiff(plan.cwd, plan.checkpoint);
	return {
		...plan,
		diffs,
		diverged: diffs.length > 0,
		restoreRequiresApproval: true,
	};
}
