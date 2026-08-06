import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import type * as LlmsProviders from "@cline/llms";
import type {
	CheckpointEntry,
	CheckpointMetadata,
} from "../hooks/checkpoint-hooks";
import { isCheckpointStashMessage } from "../hooks/checkpoint-hooks";
import type { SessionRecord } from "../types/sessions";
import { getUserRunSpan } from "./user-run-messages";

const execFile = promisify(execFileCallback);

export interface CheckpointRestorePlan {
	checkpoint: CheckpointEntry;
	messages?: LlmsProviders.Message[];
	cwd: string;
}

export interface WorktreeRestoreTransaction {
	commit(): Promise<void>;
	rollback(): Promise<void>;
}

async function resolveOptionalGitRef(
	cwd: string,
	ref: string,
): Promise<string | undefined> {
	try {
		const result = await execFile(
			"git",
			["-C", cwd, "rev-parse", "--verify", "--quiet", ref],
			{ windowsHide: true },
		);
		return result.stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

/**
 * Captures the current worktree before a destructive checkpoint restore.
 *
 * `git stash create` omits untracked files, but checkpoint restoration runs
 * `git clean -fd`. Use a short-lived `stash push --include-untracked`, move
 * its object behind a private ref, and immediately remove it from the user's
 * visible stash list. The private ref remains only until commit or rollback.
 */
export async function beginWorktreeRestoreTransaction(
	cwd: string,
): Promise<WorktreeRestoreTransaction> {
	const check = await execFile(
		"git",
		["-C", cwd, "rev-parse", "--is-inside-work-tree"],
		{ windowsHide: true },
	);
	if (check.stdout.trim() !== "true") {
		throw new Error(`${cwd} is not a git repository`);
	}
	const originalHead = (
		await execFile("git", ["-C", cwd, "rev-parse", "--verify", "HEAD"], {
			windowsHide: true,
		})
	).stdout.trim();
	const previousStashRef = await resolveOptionalGitRef(cwd, "refs/stash");
	const transactionId = randomUUID();
	const privateRef = `refs/cline/restore-transactions/${transactionId}`;

	await execFile(
		"git",
		[
			"-C",
			cwd,
			"stash",
			"push",
			"--include-untracked",
			"--message",
			`cline restore transaction ${transactionId}`,
		],
		{ windowsHide: true },
	);

	const capturedRef = await resolveOptionalGitRef(cwd, "refs/stash");
	const hasSnapshot =
		capturedRef !== undefined && capturedRef !== previousStashRef;
	if (hasSnapshot) {
		try {
			await execFile(
				"git",
				["-C", cwd, "update-ref", privateRef, capturedRef],
				{ windowsHide: true },
			);
			await execFile("git", ["-C", cwd, "stash", "drop", "stash@{0}"], {
				windowsHide: true,
			});
		} catch (captureError) {
			try {
				await execFile("git", ["-C", cwd, "reset", "--hard", originalHead], {
					windowsHide: true,
				});
				await execFile("git", ["-C", cwd, "clean", "-fd"], {
					windowsHide: true,
				});
				await execFile(
					"git",
					["-C", cwd, "stash", "apply", "--index", capturedRef],
					{ windowsHide: true },
				);
			} catch (rollbackError) {
				throw new AggregateError(
					[captureError, rollbackError],
					"Workspace snapshot and rollback both failed",
				);
			}
			throw captureError;
		}
	}

	let completed = false;
	return {
		async commit() {
			if (completed) return;
			completed = true;
			if (!hasSnapshot) return;
			// A cleanup failure must not turn a successfully started replacement
			// session into a reported failure. The private ref is harmless and
			// keeps the recovery object reachable if deletion ever fails.
			await execFile("git", ["-C", cwd, "update-ref", "-d", privateRef], {
				windowsHide: true,
			}).catch(() => undefined);
		},
		async rollback() {
			if (completed) return;
			await execFile("git", ["-C", cwd, "reset", "--hard", originalHead], {
				windowsHide: true,
			});
			await execFile("git", ["-C", cwd, "clean", "-fd"], {
				windowsHide: true,
			});
			if (hasSnapshot) {
				await execFile(
					"git",
					["-C", cwd, "stash", "apply", "--index", privateRef],
					{ windowsHide: true },
				);
				await execFile("git", ["-C", cwd, "update-ref", "-d", privateRef], {
					windowsHide: true,
				});
			}
			completed = true;
		},
	};
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

function findUserRunMessage(
	messages: LlmsProviders.Message[],
	runCount: number,
): { index: number; span: number } {
	let userRunCount = 0;
	for (let index = 0; index < messages.length; index += 1) {
		const message = messages[index];
		if (!message) {
			continue;
		}
		const span = getUserRunSpan(message);
		if (span < 1) {
			continue;
		}
		const firstRunCount = userRunCount + 1;
		userRunCount += span;
		if (userRunCount === runCount) {
			return { index, span };
		}
		if (userRunCount > runCount) {
			throw new Error(
				`Run ${runCount} is folded into a compacted message spanning runs ${firstRunCount}-${userRunCount}`,
			);
		}
	}
	throw new Error(`Could not find user message for run ${runCount}`);
}

export function trimMessagesToCheckpoint(
	messages: LlmsProviders.Message[],
	runCount: number,
): LlmsProviders.Message[] {
	const { index } = findUserRunMessage(messages, runCount);
	return messages.slice(0, index + 1);
}

export function trimMessagesBeforeUserRun(
	messages: LlmsProviders.Message[],
	runCount: number,
): LlmsProviders.Message[] {
	const { index, span } = findUserRunMessage(messages, runCount);
	if (span !== 1) {
		throw new Error(
			`Cannot fork before run ${runCount} because it is folded into a compacted message`,
		);
	}
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

async function resolveCheckpointKind(
	cwd: string,
	checkpoint: CheckpointEntry,
): Promise<NonNullable<CheckpointEntry["kind"]>> {
	if (checkpoint.kind) {
		return checkpoint.kind;
	}
	const result = await execFile(
		"git",
		["-C", cwd, "show", "-s", "--format=%P%x00%B", checkpoint.ref],
		{ windowsHide: true },
	);
	const separatorIndex = result.stdout.indexOf("\0");
	const parents =
		separatorIndex < 0
			? []
			: result.stdout
					.slice(0, separatorIndex)
					.trim()
					.split(/\s+/)
					.filter(Boolean);
	const message =
		separatorIndex < 0 ? "" : result.stdout.slice(separatorIndex + 1);

	// Checkpoints created before `kind` was persisted used Cline's stash
	// message. Requiring both its merge shape and marker keeps ordinary merge
	// commits from being passed to `git stash apply`.
	return parents.length >= 2 && isCheckpointStashMessage(message)
		? "stash"
		: "commit";
}

/**
 * True when `ref` is a snapshot stash that also captured untracked files as a
 * third parent (created by `createWorktreeStashCommit`). Such snapshots can be
 * fully rewound; older 2-parent stashes and HEAD-commit fallbacks cannot bring
 * untracked files back, so restore leaves untracked files untouched for them.
 */
async function checkpointCapturedUntracked(
	cwd: string,
	ref: string,
): Promise<boolean> {
	try {
		await execFile("git", ["-C", cwd, "cat-file", "-e", `${ref}^3^{commit}`], {
			windowsHide: true,
		});
		return true;
	} catch {
		return false;
	}
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
	const checkpointKind = await resolveCheckpointKind(cwd, checkpoint);
	const restoreBase =
		checkpointKind === "commit" ? checkpoint.ref : `${checkpoint.ref}^1`;
	await execFile(
		"git",
		["-C", cwd, "cat-file", "-e", `${restoreBase}^{commit}`],
		{ windowsHide: true },
	);
	if (checkpointKind === "stash") {
		await execFile(
			"git",
			["-C", cwd, "cat-file", "-e", `${checkpoint.ref}^2^{commit}`],
			{ windowsHide: true },
		);
	}
	const capturedUntracked = await checkpointCapturedUntracked(
		cwd,
		checkpoint.ref,
	);
	await execFile("git", ["-C", cwd, "reset", "--hard", restoreBase], {
		windowsHide: true,
	});
	// Only clear untracked files for snapshots that captured them (third
	// parent): the following `git stash apply` restores each one to its
	// checkpoint-time content from ^3, and files created after the checkpoint
	// are meant to be rewound away. `git clean -fd` leaves .gitignored paths
	// (build output, node_modules, .env) alone, and clearing before apply also
	// avoids "already exists" apply conflicts. For 2-parent stashes and
	// HEAD-commit fallbacks (no ^3) untracked files can't be reconstructed, so
	// they are left untouched — deleting them would be unrecoverable data loss.
	if (capturedUntracked) {
		await execFile("git", ["-C", cwd, "clean", "-fd"], { windowsHide: true });
	}
	if (checkpointKind === "commit") {
		return;
	}
	await execFile("git", ["-C", cwd, "stash", "apply", checkpoint.ref], {
		windowsHide: true,
	});
}
