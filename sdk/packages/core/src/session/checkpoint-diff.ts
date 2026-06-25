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
): Promise<string[]> {
	await runGit(cwd, ["cat-file", "-e", `${checkpoint.ref}^{tree}`]);
	const [trackedOutput, untrackedOutput] = await Promise.all([
		runGit(cwd, ["diff", "--name-only", "-z", checkpoint.ref, "--"]),
		runGit(cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
	]);
	const paths = new Set([
		...parseNulList(trackedOutput),
		...parseNulList(untrackedOutput),
	]);
	return [...paths].sort((a, b) => a.localeCompare(b));
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
		changedPaths.map(async (relativePath) => {
			const [leftContent, rightContent] = await Promise.all([
				readCheckpointFile(cwd, checkpoint.ref, relativePath),
				readWorktreeFile(cwd, relativePath),
			]);
			return {
				filePath: resolveGitPath(cwd, relativePath),
				leftContent,
				rightContent,
			};
		}),
	);
	return diffs.filter((diff) => diff.leftContent !== diff.rightContent);
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
