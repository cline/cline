import { execFile as execFileCallback } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type * as LlmsProviders from "@cline/llms";
import {
	readCheckpointExclusions,
	withCheckpointExcludes,
} from "../hooks/checkpoint-exclusions";
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
	messages?: LlmsProviders.MessageWithMetadata[];
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

type ThrowawayIndexGit = (args: string[]) => Promise<string>;

/** Runs git commands against a throwaway index, leaving the real one alone. */
async function withThrowawayIndex<T>(
	cwd: string,
	run: (git: ThrowawayIndexGit) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "cline-restore-index-"));
	try {
		const env = { ...process.env, GIT_INDEX_FILE: join(dir, "index") };
		return await run(
			async (args) =>
				// A split index would leave shared-index files in the user's `.git`.
				(
					await execFile(
						"git",
						["-C", cwd, "-c", "core.splitIndex=false", ...args],
						{ windowsHide: true, env, maxBuffer: Number.POSITIVE_INFINITY },
					)
				).stdout,
		);
	} finally {
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
	}
}

/**
 * Moves the untracked files a checkpoint captured out of the worktree. Returns
 * a tree holding the content they had, or undefined when none were there.
 *
 * A restore clears the worktree by the checkpoint's own file list instead of
 * `git clean`. The safety snapshot reverts or removes every uncommitted
 * `.gitignore`, so a file that was ignored when it was taken can look like a
 * plain untracked file afterwards, and nothing has a copy of it. Going by
 * name touches no file the checkpoint did not capture, and the returned tree
 * lets a rollback put back the ones it did.
 */
async function takeCapturedFiles(
	cwd: string,
	ref: string,
): Promise<string | undefined> {
	if (!(await checkpointCapturedUntracked(cwd, ref))) {
		return undefined;
	}
	return withThrowawayIndex(cwd, async (git) => {
		await git(["read-tree", `${ref}^3`]);
		// Leaves only the entries whose file exists, at its current content.
		// Git counts a path behind a symlink, or one that is a directory now, as
		// missing, so nothing below reaches outside the worktree.
		await git(["add", "--update"]);
		const present = (await git(["ls-files", "--stage", "-z"]))
			.split("\0")
			.filter(Boolean)
			// "<mode> <object> <stage>\t<path>". A nested repository is a
			// gitlink entry; its directory is not ours to remove.
			.filter((entry) => !entry.startsWith("160000 "))
			.map((entry) => entry.slice(entry.indexOf("\t") + 1));
		if (present.length === 0) {
			return undefined;
		}
		// No ref holds this tree. It only has to outlive the restore, and
		// `git gc` leaves freshly written objects alone.
		const tree = (await git(["write-tree"])).trim();
		try {
			for (const relativePath of present) {
				await rm(join(cwd, relativePath), { force: true });
				for (
					let parent = dirname(relativePath);
					parent !== ".";
					parent = dirname(parent)
				) {
					try {
						await rmdir(join(cwd, parent));
					} catch {
						break;
					}
				}
			}
		} catch (error) {
			await git(["checkout-index", "--all"]).catch(() => undefined);
			throw error;
		}
		return tree;
	});
}

/** Writes the files of a tree from `takeCapturedFiles` back into the worktree. */
async function putBackFiles(cwd: string, tree: string): Promise<void> {
	await withThrowawayIndex(cwd, async (git) => {
		await git(["read-tree", tree]);
		await git(["checkout-index", "--all"]);
	});
}

/**
 * Captures the current worktree before a destructive checkpoint restore.
 *
 * `git stash create` omits untracked files, and a restore replaces them too.
 * Use a short-lived `stash push --include-untracked`, move its object behind
 * a private ref, and immediately remove it from the user's visible stash
 * list. The private ref remains only until commit or rollback.
 *
 * The stash leaves ignored files in place. For a checkpoint made with the
 * default exclusions, excluded files (media, dependency trees, ...) count as
 * ignored here, as in its snapshot. Of the files left, the ones the checkpoint
 * captured are moved out as well, so the checkpoint can be written without
 * overwriting anything. Ignore rules are read for the stash and never again:
 * from there on the restore only handles files it has a copy of.
 */
export async function beginWorktreeRestoreTransaction(
	cwd: string,
	checkpoint: CheckpointEntry,
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

	await withCheckpointExcludes(cwd, checkpoint.exclusions, (excludeArgs) =>
		execFile(
			"git",
			[
				"-C",
				cwd,
				...excludeArgs,
				"stash",
				"push",
				"--include-untracked",
				"--message",
				`cline restore transaction ${transactionId}`,
			],
			{ windowsHide: true },
		),
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

	const restoreSnapshot = async () => {
		if (!hasSnapshot) return;
		await execFile(
			"git",
			["-C", cwd, "stash", "apply", "--index", privateRef],
			{ windowsHide: true },
		);
		await execFile("git", ["-C", cwd, "update-ref", "-d", privateRef], {
			windowsHide: true,
		});
	};

	let displacedTree: string | undefined;
	try {
		displacedTree = await takeCapturedFiles(cwd, checkpoint.ref);
	} catch (captureError) {
		try {
			await restoreSnapshot();
		} catch (rollbackError) {
			throw new AggregateError(
				[captureError, rollbackError],
				"Workspace snapshot and rollback both failed",
			);
		}
		throw captureError;
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
			// Every captured file was moved out above, so the ones here now were
			// written by the checkpoint.
			await takeCapturedFiles(cwd, checkpoint.ref);
			if (displacedTree) {
				await putBackFiles(cwd, displacedTree);
			}
			await restoreSnapshot();
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
			const exclusions = readCheckpointExclusions(entry.exclusions);
			return [
				{
					ref,
					createdAt,
					runCount,
					...(kind ? { kind } : {}),
					...(exclusions ? { exclusions } : {}),
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

function findUserRunMessage(
	messages: LlmsProviders.MessageWithMetadata[],
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
	messages: LlmsProviders.MessageWithMetadata[],
	runCount: number,
): LlmsProviders.MessageWithMetadata[] {
	const { index } = findUserRunMessage(messages, runCount);
	return messages.slice(0, index + 1);
}

export function trimMessagesBeforeUserRun(
	messages: LlmsProviders.MessageWithMetadata[],
	runCount: number,
): LlmsProviders.MessageWithMetadata[] {
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
	messages?: LlmsProviders.MessageWithMetadata[];
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

/** Commits reachable from `to` but not from `from`; undefined when unknown. */
async function countCommitsBetween(
	cwd: string,
	from: string,
	to: string,
): Promise<number | undefined> {
	try {
		const result = await execFile(
			"git",
			["-C", cwd, "rev-list", "--count", `${from}..${to}`],
			{ windowsHide: true },
		);
		const count = Number(result.stdout.trim());
		return Number.isFinite(count) ? count : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Writes a checkpoint into a worktree that `beginWorktreeRestoreTransaction`
 * has cleared. It removes no untracked file itself: one left in the way of a
 * captured file makes `git stash apply` fail, and the transaction rolls back.
 */
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
	const restoreBaseSha = (
		await execFile(
			"git",
			["-C", cwd, "rev-parse", "--verify", `${restoreBase}^{commit}`],
			{ windowsHide: true },
		)
	).stdout.trim();
	// `git reset --hard` moves the current branch pointer. If HEAD is no
	// longer the commit this checkpoint was created on (commits were made
	// after it, or the branch was rebased/switched), resetting would silently
	// knock those commits off the branch, leaving them reachable only through
	// the reflog. Refuse instead of destroying history; the caller can still
	// restore the chat only, or move the branch back deliberately.
	const currentHead = (
		await execFile("git", ["-C", cwd, "rev-parse", "--verify", "HEAD"], {
			windowsHide: true,
		})
	).stdout.trim();
	if (currentHead !== restoreBaseSha) {
		const commitsAfter = await countCommitsBetween(
			cwd,
			restoreBaseSha,
			currentHead,
		);
		const reason =
			commitsAfter && commitsAfter > 0
				? `${commitsAfter} commit${commitsAfter === 1 ? " was" : "s were"} added to the current branch after this checkpoint and would be removed by the restore`
				: "the current branch is no longer on the commit this checkpoint was created from (e.g. after a rebase or branch switch)";
		throw new Error(
			`Cannot restore the workspace: ${reason}. Restore the chat only, or move the branch back to ${restoreBaseSha.slice(0, 12)} manually (e.g. with git reset) before restoring the workspace.`,
		);
	}
	if (checkpointKind === "stash") {
		await execFile(
			"git",
			["-C", cwd, "cat-file", "-e", `${checkpoint.ref}^2^{commit}`],
			{ windowsHide: true },
		);
	}
	// `git update-ref <ref> <new> <old>` is git's native compare-and-swap: it
	// moves HEAD to the restore base only if HEAD still points at the commit
	// verified above, closing the race between the guard check and the reset.
	// The bare `reset --hard` then syncs the index and worktree to the
	// already-moved HEAD without touching the branch pointer again.
	await execFile(
		"git",
		[
			"-C",
			cwd,
			"update-ref",
			"-m",
			"cline: checkpoint restore",
			"HEAD",
			restoreBaseSha,
			currentHead,
		],
		{ windowsHide: true },
	);
	await execFile("git", ["-C", cwd, "reset", "--hard"], {
		windowsHide: true,
	});
	if (checkpointKind === "commit") {
		return;
	}
	await execFile("git", ["-C", cwd, "stash", "apply", checkpoint.ref], {
		windowsHide: true,
	});
}
