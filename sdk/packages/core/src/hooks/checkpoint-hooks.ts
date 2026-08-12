import { execFile as execFileCallback } from "node:child_process";
import { lstat, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentHooks, BasicLogger } from "@cline/shared";
import { countUserRunMessages } from "../session/user-run-messages";

const execFile = promisify(execFileCallback);
const CHECKPOINT_STASH_MESSAGE_PREFIX = "cline checkpoint session=";
const DEFAULT_MAX_UNTRACKED_FILE_BYTES = 100 * 1024 * 1024;
const DEFAULT_GIT_TIMEOUT_MS = 60_000;
const LS_FILES_MAX_BUFFER = 1024 * 1024 * 64;

export function isCheckpointStashMessage(message: string): boolean {
	return message.includes(CHECKPOINT_STASH_MESSAGE_PREFIX);
}

/**
 * Per-session scratch directory holding the persistent `GIT_INDEX_FILE` used
 * to snapshot untracked files. Persisting the index across turns lets git's
 * stat cache skip re-reading (and re-hashing) untracked files that have not
 * changed since the previous checkpoint — without it, every turn re-hashes
 * every untracked byte in the workspace. Removed by `deleteCheckpointRefs`.
 */
export function checkpointScratchDir(sessionId: string): string {
	const safeId = sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
	return join(tmpdir(), `cline-checkpoint-${safeId}`);
}

export interface CheckpointEntry {
	ref: string;
	createdAt: number;
	runCount: number;
	kind?: "stash" | "commit";
	/**
	 * Repo-relative paths of untracked files that were excluded from the
	 * snapshot because they exceeded the size cap. They exist only on disk, so
	 * the restore path must exempt them from its `git clean` — deleting them
	 * would be unrecoverable data loss.
	 */
	skippedUntracked?: string[];
}

export interface CheckpointMetadata {
	latest: CheckpointEntry;
	history: CheckpointEntry[];
}

type CreateCheckpointHooksOptions = {
	cwd: string;
	sessionId: string;
	logger?: BasicLogger;
	readSessionMetadata: () => Promise<Record<string, unknown> | undefined>;
	writeSessionMetadata: (
		metadata: Record<string, unknown>,
	) => Promise<void> | void;
	/**
	 * Optional custom checkpoint implementation. When provided, the built-in
	 * git stash/ref logic is skipped entirely and this function is called
	 * instead. Return `undefined` to skip writing a checkpoint for that run.
	 */
	createCheckpoint?: (context: {
		cwd: string;
		sessionId: string;
		runCount: number;
	}) => Promise<CheckpointEntry | undefined> | CheckpointEntry | undefined;
	/**
	 * Untracked files larger than this many bytes are left out of the snapshot
	 * (and recorded on the entry as `skippedUntracked`). Defaults to 100 MiB.
	 */
	maxUntrackedFileBytes?: number;
	/**
	 * Overall time budget for the git snapshot on each turn. When exceeded the
	 * checkpoint degrades to a HEAD-commit entry (or is skipped for that turn)
	 * instead of blocking the request path. Defaults to 60s.
	 */
	gitTimeoutMs?: number;
};

function warn(logger: BasicLogger | undefined, message: string): void {
	logger?.log(message, { severity: "warn" });
}

function readCheckpointMetadata(
	metadata: Record<string, unknown> | undefined,
): CheckpointMetadata | undefined {
	const candidate = metadata?.checkpoint;
	if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
		return undefined;
	}
	const record = candidate as Partial<CheckpointMetadata>;
	if (!record.latest || !Array.isArray(record.history)) {
		return undefined;
	}
	const latest = record.latest as Partial<CheckpointEntry>;
	const history = record.history.filter(
		(entry): entry is CheckpointEntry =>
			!!entry &&
			typeof entry === "object" &&
			typeof (entry as Partial<CheckpointEntry>).ref === "string" &&
			typeof (entry as Partial<CheckpointEntry>).createdAt === "number" &&
			typeof (entry as Partial<CheckpointEntry>).runCount === "number",
	);
	if (
		typeof latest.ref !== "string" ||
		typeof latest.createdAt !== "number" ||
		typeof latest.runCount !== "number"
	) {
		return undefined;
	}
	return {
		latest: latest as CheckpointEntry,
		history,
	};
}

async function runGit(
	cwd: string,
	args: string[],
	timeoutMs?: number,
): Promise<{ stdout: string; stderr: string }> {
	const result = await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
		...(timeoutMs !== undefined ? { timeout: Math.max(1, timeoutMs) } : {}),
	});
	return {
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
	};
}

async function runGitWithIndex(
	cwd: string,
	indexFile: string,
	args: string[],
	timeoutMs?: number,
): Promise<string> {
	const result = await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
		maxBuffer: LS_FILES_MAX_BUFFER,
		env: { ...process.env, GIT_INDEX_FILE: indexFile },
		...(timeoutMs !== undefined ? { timeout: Math.max(1, timeoutMs) } : {}),
	});
	return result.stdout.trim();
}

/**
 * Shared time budget for all git calls of one snapshot attempt: each call gets
 * only what is left, so the total can never exceed the configured timeout no
 * matter how many git invocations the snapshot needs.
 */
type SnapshotBudget = { timeoutAt: number };

function remainingMs(budget: SnapshotBudget): number {
	const remaining = budget.timeoutAt - Date.now();
	if (remaining <= 0) {
		throw new Error("checkpoint git time budget exhausted");
	}
	return remaining;
}

/**
 * Bounds non-git async work (e.g. the untracked `lstat` scan) with the same
 * snapshot budget the git subprocesses use — a stalled filesystem must not be
 * able to block the turn through a syscall any more than through git. The
 * underlying work is not cancellable and may settle later; the caller just
 * stops waiting for it.
 */
async function raceBudget<T>(
	budget: SnapshotBudget,
	work: Promise<T>,
): Promise<T> {
	const remaining = remainingMs(budget);
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<never>((_, reject) => {
				timer = setTimeout(
					() => reject(new Error("checkpoint stat scan exceeded time budget")),
					remaining,
				);
			}),
		]);
	} finally {
		clearTimeout(timer);
	}
}

type SnapshotOptions = {
	cwd: string;
	scratchDir: string;
	maxUntrackedFileBytes: number;
	budget: SnapshotBudget;
};

/**
 * Builds a commit whose tree contains only the current untracked (but not
 * git-ignored) files, without touching the working tree or the real index.
 * This mirrors the third parent that `git stash create --include-untracked`
 * records, which the plain `git stash create` used elsewhere omits. Returns
 * an `undefined` commit when there are no untracked files to capture.
 *
 * Untracked files above the size cap are excluded and reported via `skipped`
 * so the checkpoint entry (and later the restore path) knows they were never
 * part of the snapshot.
 */
async function createUntrackedParentCommit(
	options: SnapshotOptions,
): Promise<{ commit?: string; skipped: string[] }> {
	const { cwd, scratchDir, maxUntrackedFileBytes, budget } = options;
	const listing = await execFile(
		"git",
		["-C", cwd, "ls-files", "--others", "--exclude-standard", "-z"],
		{
			windowsHide: true,
			maxBuffer: LS_FILES_MAX_BUFFER,
			timeout: remainingMs(budget),
		},
	);
	const untrackedFiles = listing.stdout.split("\0").filter(Boolean);
	const skipped: string[] = [];
	const eligible: string[] = [];
	await raceBudget(
		budget,
		Promise.all(
			untrackedFiles.map(async (path) => {
				try {
					const stats = await lstat(join(cwd, path));
					if (stats.isFile() && stats.size > maxUntrackedFileBytes) {
						skipped.push(path);
						return;
					}
				} catch {
					// Vanished between listing and stat — nothing to snapshot.
					return;
				}
				eligible.push(path);
			}),
		),
	);
	skipped.sort();
	eligible.sort();
	if (eligible.length === 0) {
		return { commit: undefined, skipped };
	}
	await mkdir(scratchDir, { recursive: true });
	const indexFile = join(scratchDir, "index");
	const pathspecFile = join(scratchDir, "pathspec");
	// Feed paths via a NUL-delimited pathspec file so large untracked sets
	// cannot overflow the command-line argument limit.
	await writeFile(pathspecFile, `${eligible.join("\0")}\0`);
	const addArgs = [
		"add",
		"--force",
		"--pathspec-from-file",
		pathspecFile,
		"--pathspec-file-nul",
	];
	try {
		await runGitWithIndex(cwd, indexFile, addArgs, remainingMs(budget));
	} catch {
		// A corrupt index (crash mid-write, git version change) would otherwise
		// fail every turn from here on; rebuild it from scratch once. The retry
		// pays a full re-hash, so anything else propagates to the caller.
		await rm(indexFile, { force: true });
		await runGitWithIndex(cwd, indexFile, addArgs, remainingMs(budget));
	}
	// Drop index entries that fell out of the eligible set (file deleted,
	// became tracked, or grew past the cap) so they don't ghost into the
	// snapshot tree — `git add` with a pathspec never removes entries.
	const indexedListing = await execFile("git", ["-C", cwd, "ls-files", "-z"], {
		windowsHide: true,
		maxBuffer: LS_FILES_MAX_BUFFER,
		env: { ...process.env, GIT_INDEX_FILE: indexFile },
		timeout: remainingMs(budget),
	});
	const eligibleSet = new Set(eligible);
	const stale = indexedListing.stdout
		.split("\0")
		.filter(Boolean)
		.filter((path) => !eligibleSet.has(path));
	// `update-index` has no --pathspec-from-file, so pass paths as arguments in
	// length-bounded batches to stay under Windows' ~32k command-line limit.
	let batch: string[] = [];
	let batchLength = 0;
	const flushBatch = async () => {
		if (batch.length === 0) return;
		await runGitWithIndex(
			cwd,
			indexFile,
			["update-index", "--force-remove", "--", ...batch],
			remainingMs(budget),
		);
		batch = [];
		batchLength = 0;
	};
	for (const path of stale) {
		if (batch.length > 0 && batchLength + path.length > 8000) {
			await flushBatch();
		}
		batch.push(path);
		batchLength += path.length + 1;
	}
	await flushBatch();
	const tree = await runGitWithIndex(
		cwd,
		indexFile,
		["write-tree"],
		remainingMs(budget),
	);
	if (!tree) {
		return { commit: undefined, skipped };
	}
	const commit = await runGitWithIndex(
		cwd,
		indexFile,
		["commit-tree", tree, "-m", "untracked files on cline checkpoint"],
		remainingMs(budget),
	);
	return { commit: commit || undefined, skipped };
}

/**
 * Creates a stash-compatible snapshot commit of the working tree that, unlike
 * `git stash create`, also captures untracked files as a third parent. The
 * checkpoint restore path rewinds untracked files for snapshots that carry
 * this third parent, so any file the agent created (or an untracked file it
 * changed) can be brought back to its checkpoint-time state. Returns
 * `undefined` when there is nothing to snapshot (clean working tree with no
 * untracked files), letting the caller fall back to a HEAD commit checkpoint.
 */
async function createWorktreeStashCommit(
	options: SnapshotOptions,
	message: string,
): Promise<{ ref?: string; skipped: string[] }> {
	const { cwd, budget } = options;
	const stashRef = (
		await runGit(cwd, ["stash", "create", message], remainingMs(budget))
	).stdout;
	const untracked = await createUntrackedParentCommit(options);
	const untrackedParent = untracked.commit;
	const skipped = untracked.skipped;

	if (stashRef) {
		if (!untrackedParent) {
			// Tracked changes only — the plain stash already captures them.
			return { ref: stashRef, skipped };
		}
		const tree = (
			await runGit(
				cwd,
				["rev-parse", `${stashRef}^{tree}`],
				remainingMs(budget),
			)
		).stdout;
		const base = (
			await runGit(cwd, ["rev-parse", `${stashRef}^1`], remainingMs(budget))
		).stdout;
		const indexParent = (
			await runGit(cwd, ["rev-parse", `${stashRef}^2`], remainingMs(budget))
		).stdout;
		if (!tree || !base || !indexParent) {
			return { ref: stashRef, skipped };
		}
		return {
			ref:
				(
					await runGit(
						cwd,
						[
							"commit-tree",
							tree,
							"-p",
							base,
							"-p",
							indexParent,
							"-p",
							untrackedParent,
							"-m",
							message,
						],
						remainingMs(budget),
					)
				).stdout || stashRef,
			skipped,
		};
	}

	// Tracked worktree is clean. Only synthesize a stash when there are
	// untracked files to preserve; otherwise the caller uses a HEAD checkpoint.
	if (!untrackedParent) {
		return { ref: undefined, skipped };
	}
	const head = (await runGit(cwd, ["rev-parse", "HEAD"], remainingMs(budget)))
		.stdout;
	const headTree = (
		await runGit(cwd, ["rev-parse", "HEAD^{tree}"], remainingMs(budget))
	).stdout;
	if (!head || !headTree) {
		return { ref: undefined, skipped };
	}
	// The index parent mirrors the (unchanged) HEAD tree so the synthesized
	// commit has the two/three-parent shape `git stash apply` expects.
	const indexParent = (
		await runGit(
			cwd,
			["commit-tree", headTree, "-p", head, "-m", "index on cline checkpoint"],
			remainingMs(budget),
		)
	).stdout;
	if (!indexParent) {
		return { ref: undefined, skipped };
	}
	return {
		ref:
			(
				await runGit(
					cwd,
					[
						"commit-tree",
						headTree,
						"-p",
						head,
						"-p",
						indexParent,
						"-p",
						untrackedParent,
						"-m",
						message,
					],
					remainingMs(budget),
				)
			).stdout || undefined,
		skipped,
	};
}

/**
 * Deletes all private git refs under refs/cline/checkpoints/{sessionId}/ that
 * were created by the checkpoint system to keep stash objects reachable.
 * Errors are swallowed - if the cwd is not a git repo or the refs don't exist,
 * the delete is a no-op.
 */
export async function deleteCheckpointRefs(
	cwd: string | null | undefined,
	sessionId: string,
): Promise<void> {
	// The scratch dir (persistent untracked index) is keyed by session id
	// alone, so clean it up even when no cwd is known.
	await rm(checkpointScratchDir(sessionId), {
		recursive: true,
		force: true,
	}).catch(() => undefined);
	if (!cwd) return;
	const prefix = `refs/cline/checkpoints/${sessionId}/`;
	try {
		const { stdout } = await runGit(cwd, [
			"for-each-ref",
			"--format=%(refname)",
			prefix,
		]);
		const refs = stdout.trim().split("\n").filter(Boolean);
		await Promise.allSettled(
			refs.map((ref) => runGit(cwd, ["update-ref", "-d", ref])),
		);
	} catch {
		// Not a git repo or git not available - ignore.
	}
}

export async function retainCheckpointRefs(
	cwd: string | null | undefined,
	sessionId: string,
	checkpoints: readonly CheckpointEntry[],
): Promise<void> {
	if (!cwd || checkpoints.length === 0) return;
	await Promise.allSettled(
		checkpoints.map((entry) =>
			runGit(cwd, [
				"update-ref",
				`refs/cline/checkpoints/${sessionId}/${entry.runCount}`,
				entry.ref,
			]),
		),
	);
}

function upsertCheckpointHistory(
	history: readonly CheckpointEntry[],
	entry: CheckpointEntry,
): CheckpointEntry[] {
	const existingIndex = history.findIndex(
		(candidate) => candidate.runCount === entry.runCount,
	);
	if (existingIndex < 0) {
		return [...history, entry];
	}
	return history.map((candidate, index) =>
		index === existingIndex ? entry : candidate,
	);
}

export function createCheckpointHooks(
	options: CreateCheckpointHooksOptions,
): AgentHooks {
	let repoSupported: boolean | undefined;
	// Number of messages present when the current run started, captured in
	// beforeRun. For hosts that append the run's prompt *after* beforeRun (e.g.
	// `AgentRuntime.run(input)`), the delta since this index holds the new user
	// message and is a reliable "new user turn" signal. It is only a hint, not
	// the sole gate: hosts that seed the prompt *before* the run (SessionRuntime
	// calls `run("")` with the prompt already in initialMessages) leave the
	// delta empty, and a fresh hook instance after a process restart resets it
	// to undefined — so the durable persisted checkpoint history is what
	// actually prevents duplicate/overwriting checkpoints.
	let rootRunMessageStart: number | undefined;
	const maxUntrackedFileBytes =
		options.maxUntrackedFileBytes ?? DEFAULT_MAX_UNTRACKED_FILE_BYTES;
	const gitTimeoutMs = options.gitTimeoutMs ?? DEFAULT_GIT_TIMEOUT_MS;
	// Paths already warn-logged as skipped, so a file that stays over the cap
	// for the whole session produces one warning, not one per turn.
	const warnedSkipped = new Set<string>();

	const ensureGitRepository = async (): Promise<boolean> => {
		// Only cache the positive answer: a cwd that is not a git repo can
		// become one mid-session (the user runs `git init`), and this probe
		// fires at most once per user turn, so re-checking is cheap. Once the
		// repo is detected, checkpoints start applying from that turn onward.
		if (repoSupported === true) {
			return true;
		}
		try {
			const result = await runGit(
				options.cwd,
				["rev-parse", "--is-inside-work-tree"],
				gitTimeoutMs,
			);
			repoSupported = result.stdout === "true";
		} catch {
			repoSupported = false;
		}
		return repoSupported;
	};

	const createCheckpoint = async (
		runCount: number,
	): Promise<CheckpointEntry | undefined> => {
		if (options.createCheckpoint) {
			return await options.createCheckpoint({
				cwd: options.cwd,
				sessionId: options.sessionId,
				runCount,
			});
		}

		if (!(await ensureGitRepository())) {
			return undefined;
		}

		const createHeadCheckpoint = async (
			warnPrefix: string,
		): Promise<CheckpointEntry | undefined> => {
			try {
				// Deliberately a fresh timeout rather than the snapshot budget: the
				// fallback must still work when the budget is what just expired.
				const result = await runGit(
					options.cwd,
					["rev-parse", "HEAD"],
					gitTimeoutMs,
				);
				const ref = result.stdout.trim();
				if (!ref) {
					return undefined;
				}
				return {
					ref,
					createdAt: Date.now(),
					runCount,
					kind: "commit",
				};
			} catch (error) {
				warn(
					options.logger,
					`${warnPrefix}: ${error instanceof Error ? error.message : String(error)}`,
				);
				return undefined;
			}
		};

		const message = `${CHECKPOINT_STASH_MESSAGE_PREFIX}${options.sessionId} run=${runCount}`;
		const startedAt = Date.now();
		let snapshot: { ref?: string; skipped: string[] };
		try {
			snapshot = await createWorktreeStashCommit(
				{
					cwd: options.cwd,
					scratchDir: checkpointScratchDir(options.sessionId),
					maxUntrackedFileBytes,
					budget: { timeoutAt: startedAt + gitTimeoutMs },
				},
				message,
			);
		} catch (error) {
			warn(
				options.logger,
				`Checkpoint snapshot failed after ${Date.now() - startedAt}ms: ${error instanceof Error ? error.message : String(error)}`,
			);
			return createHeadCheckpoint("Checkpoint HEAD fallback failed");
		}
		const newSkipped = snapshot.skipped.filter(
			(path) => !warnedSkipped.has(path),
		);
		if (newSkipped.length > 0) {
			for (const path of newSkipped) {
				warnedSkipped.add(path);
			}
			warn(
				options.logger,
				`Checkpoint skipped ${newSkipped.length} untracked file(s) over ${maxUntrackedFileBytes} bytes (they will not be restorable): ${newSkipped.slice(0, 10).join(", ")}${newSkipped.length > 10 ? ", …" : ""}`,
			);
		}
		const ref = snapshot.ref ?? "";
		if (!ref) {
			return createHeadCheckpoint("Checkpoint HEAD fallback failed");
		}

		// Store the stash commit under a private ref namespace so it is
		// invisible to the user's normal `git stash list` workflow.
		// `refs/stash` is what populates that list; writing to any other
		// ref path keeps the object reachable (GC-safe) without surfacing
		// it to the user.  The raw SHA already works with `git stash apply`
		// on the restore path, so no restore-side changes are needed.
		const privateRef = `refs/cline/checkpoints/${options.sessionId}/${runCount}`;
		try {
			await runGit(options.cwd, ["update-ref", privateRef, ref], gitTimeoutMs);
		} catch (error) {
			warn(
				options.logger,
				`Checkpoint store failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}

		return {
			ref,
			createdAt: Date.now(),
			runCount,
			kind: "stash",
			...(snapshot.skipped.length > 0
				? { skippedUntracked: snapshot.skipped }
				: {}),
		};
	};

	return {
		beforeRun: async ({ snapshot }) => {
			if (snapshot.parentAgentId == null) {
				rootRunMessageStart = snapshot.messages.length;
			}
			return undefined;
		},
		beforeModel: async ({ snapshot }) => {
			if (snapshot.parentAgentId != null || snapshot.iteration !== 1) {
				return undefined;
			}
			// Messages the runtime appended after beforeRun. When the host passes
			// the prompt as run input this delta contains the new user turn; when
			// the host seeds it beforehand (or the hook is a fresh instance after
			// a restart) the delta is empty, so it is only a positive hint.
			const currentRunMessages = snapshot.messages.slice(
				rootRunMessageStart ?? Math.max(0, snapshot.messages.length - 1),
			);
			rootRunMessageStart = undefined;
			// Span-aware count so numbering survives compaction (which folds
			// several user turns into one summary message carrying userRunSpan).
			const runCount = countUserRunMessages(snapshot.messages);
			if (runCount < 1) {
				return undefined;
			}
			const metadata = await options.readSessionMetadata();
			const existing = readCheckpointMetadata(metadata);
			// A run warrants a checkpoint when it introduces a new user turn.
			// `introducedUserRun` catches the run-input path (and refreshes the
			// entry on edit-and-regenerate); `alreadyCheckpointed`, read from the
			// durable session history, catches the seeded-prompt path and, unlike
			// any in-memory counter, still holds after a process restart. Skip
			// only when neither applies: a continuation/resumption re-running a
			// run that was already checkpointed (which must NOT overwrite the
			// pre-run snapshot with the now-mutated workspace).
			const introducedUserRun = countUserRunMessages(currentRunMessages) >= 1;
			const alreadyCheckpointed =
				existing?.history.some((entry) => entry.runCount === runCount) ?? false;
			if (!introducedUserRun && alreadyCheckpointed) {
				return undefined;
			}
			const entry = await createCheckpoint(runCount);
			if (!entry) {
				return undefined;
			}
			if (existing?.latest.ref === entry.ref) {
				return undefined;
			}
			const history = upsertCheckpointHistory(existing?.history ?? [], entry);
			await options.writeSessionMetadata({
				...(metadata ?? {}),
				checkpoint: {
					latest: entry,
					history,
				} satisfies CheckpointMetadata,
			});
			return undefined;
		},
	};
}
