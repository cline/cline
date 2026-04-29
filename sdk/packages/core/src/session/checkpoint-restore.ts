import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type * as LlmsProviders from "@clinebot/llms";
import type { CheckpointEntry } from "../hooks/checkpoint-hooks";
import type { SessionRecord } from "../types/sessions";

const execFile = promisify(execFileCallback);

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
			return [{ ref, createdAt, runCount, ...(kind ? { kind } : {}) }];
		});
}

export function trimMessagesToCheckpoint(
	messages: LlmsProviders.Message[],
	runCount: number,
): LlmsProviders.Message[] {
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
			return messages.slice(0, index + 1);
		}
	}
	throw new Error(`Could not find user message for checkpoint run ${runCount}`);
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
	const checkpoint = readSessionCheckpointHistory(input.session).find(
		(entry) => entry.runCount === runCount,
	);
	if (!checkpoint) {
		throw new Error(
			`No checkpoint found for run ${runCount} in session ${input.session.sessionId}`,
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

export async function applyCheckpointToWorktree(
	cwd: string,
	checkpoint: CheckpointEntry,
): Promise<void> {
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
	await execFile("git", ["-C", cwd, "reset", "--hard"], { windowsHide: true });
	await execFile("git", ["-C", cwd, "clean", "-fd"], { windowsHide: true });
	if (checkpoint.kind === "commit") {
		await execFile("git", ["-C", cwd, "reset", "--hard", checkpoint.ref], {
			windowsHide: true,
		});
		return;
	}
	await execFile("git", ["-C", cwd, "stash", "apply", checkpoint.ref], {
		windowsHide: true,
	});
}
