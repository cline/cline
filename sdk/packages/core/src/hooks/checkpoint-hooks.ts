import { execFile as execFileCallback } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentHooks, BasicLogger, ITelemetryService } from "@cline/shared";
import { countUserRunMessages } from "../session/user-run-messages";

const execFile = promisify(execFileCallback);
const CHECKPOINT_STASH_MESSAGE_PREFIX = "cline checkpoint session=";
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
	 * Emits one `checkpoint.snapshot` event per built-in snapshot attempt so
	 * snapshot cost and degradations (HEAD fallbacks, skipped turns) are
	 * observable in the field, not only in local logs. Properties carry
	 * outcome and duration — never file paths or contents.
	 */
	telemetry?: Pick<ITelemetryService, "capture">;
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
): Promise<{ stdout: string; stderr: string }> {
	const result = await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
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
): Promise<string> {
	const result = await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
		maxBuffer: LS_FILES_MAX_BUFFER,
		env: { ...process.env, GIT_INDEX_FILE: indexFile },
	});
	return result.stdout.trim();
}

/**
 * Builds a commit whose tree contains only the current untracked (but not
 * git-ignored) files, without touching the working tree or the real index.
 * This mirrors the third parent that `git stash create --include-untracked`
 * records, which the plain `git stash create` used elsewhere omits. Returns
 * `undefined` when there are no untracked files to capture.
 */
async function createUntrackedParentCommit(
	cwd: string,
	scratchDir: string,
): Promise<string | undefined> {
	const listing = await execFile(
		"git",
		["-C", cwd, "ls-files", "--others", "--exclude-standard", "-z"],
		{ windowsHide: true, maxBuffer: LS_FILES_MAX_BUFFER },
	);
	const untrackedFiles = listing.stdout.split("\0").filter(Boolean);
	if (untrackedFiles.length === 0) {
		return undefined;
	}
	await mkdir(scratchDir, { recursive: true });
	const indexFile = join(scratchDir, "index");
	const pathspecFile = join(scratchDir, "pathspec");
	// Feed paths via a NUL-delimited pathspec file so large untracked sets
	// cannot overflow the command-line argument limit.
	await writeFile(pathspecFile, `${untrackedFiles.join("\0")}\0`);
	const addArgs = [
		"add",
		"--force",
		"--pathspec-from-file",
		pathspecFile,
		"--pathspec-file-nul",
	];
	try {
		await runGitWithIndex(cwd, indexFile, addArgs);
	} catch {
		// A corrupt index (crash mid-write, git version change) would otherwise
		// fail every turn from here on; rebuild it from scratch once. The retry
		// pays a full re-hash, so anything else propagates to the caller.
		await rm(indexFile, { force: true });
		await runGitWithIndex(cwd, indexFile, addArgs);
	}
	// Drop index entries that fell out of the untracked set (file deleted or
	// became tracked) so they don't ghost into the snapshot tree — `git add`
	// with a pathspec never removes entries.
	const indexedListing = await execFile("git", ["-C", cwd, "ls-files", "-z"], {
		windowsHide: true,
		maxBuffer: LS_FILES_MAX_BUFFER,
		env: { ...process.env, GIT_INDEX_FILE: indexFile },
	});
	const untrackedSet = new Set(untrackedFiles);
	const stale = indexedListing.stdout
		.split("\0")
		.filter(Boolean)
		.filter((path) => !untrackedSet.has(path));
	// `update-index` has no --pathspec-from-file, so pass paths as arguments in
	// length-bounded batches to stay under Windows' ~32k command-line limit.
	let batch: string[] = [];
	let batchLength = 0;
	const flushBatch = async () => {
		if (batch.length === 0) return;
		await runGitWithIndex(cwd, indexFile, [
			"update-index",
			"--force-remove",
			"--",
			...batch,
		]);
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
	const tree = await runGitWithIndex(cwd, indexFile, ["write-tree"]);
	if (!tree) {
		return undefined;
	}
	const commit = await runGitWithIndex(cwd, indexFile, [
		"commit-tree",
		tree,
		"-m",
		"untracked files on cline checkpoint",
	]);
	return commit || undefined;
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
	cwd: string,
	scratchDir: string,
	message: string,
): Promise<string | undefined> {
	const stashRef = (await runGit(cwd, ["stash", "create", message])).stdout;
	const untrackedParent = await createUntrackedParentCommit(cwd, scratchDir);

	if (stashRef) {
		if (!untrackedParent) {
			// Tracked changes only — the plain stash already captures them.
			return stashRef;
		}
		const tree = (await runGit(cwd, ["rev-parse", `${stashRef}^{tree}`]))
			.stdout;
		const base = (await runGit(cwd, ["rev-parse", `${stashRef}^1`])).stdout;
		const indexParent = (await runGit(cwd, ["rev-parse", `${stashRef}^2`]))
			.stdout;
		if (!tree || !base || !indexParent) {
			return stashRef;
		}
		return (
			(
				await runGit(cwd, [
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
				])
			).stdout || stashRef
		);
	}

	// Tracked worktree is clean. Only synthesize a stash when there are
	// untracked files to preserve; otherwise the caller uses a HEAD checkpoint.
	if (!untrackedParent) {
		return undefined;
	}
	const head = (await runGit(cwd, ["rev-parse", "HEAD"])).stdout;
	const headTree = (await runGit(cwd, ["rev-parse", "HEAD^{tree}"])).stdout;
	if (!head || !headTree) {
		return undefined;
	}
	// The index parent mirrors the (unchanged) HEAD tree so the synthesized
	// commit has the two/three-parent shape `git stash apply` expects.
	const indexParent = (
		await runGit(cwd, [
			"commit-tree",
			headTree,
			"-p",
			head,
			"-m",
			"index on cline checkpoint",
		])
	).stdout;
	if (!indexParent) {
		return undefined;
	}
	return (
		(
			await runGit(cwd, [
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
			])
		).stdout || undefined
	);
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

	const ensureGitRepository = async (): Promise<boolean> => {
		// Only cache the positive answer: a cwd that is not a git repo can
		// become one mid-session (the user runs `git init`), and this probe
		// fires at most once per user turn, so re-checking is cheap. Once the
		// repo is detected, checkpoints start applying from that turn onward.
		if (repoSupported === true) {
			return true;
		}
		try {
			const result = await runGit(options.cwd, [
				"rev-parse",
				"--is-inside-work-tree",
			]);
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

		const startedAt = Date.now();
		// One event per built-in snapshot attempt. Outcomes: "stash" (full
		// snapshot), "head_clean" (clean worktree, HEAD entry is the normal
		// result), "head_fallback" (degraded to HEAD after a failure), and
		// "skipped" (no checkpoint written this turn). Durations only — never
		// file paths or contents.
		const captureSnapshot = (
			outcome: "stash" | "head_clean" | "head_fallback" | "skipped",
		): void => {
			options.telemetry?.capture({
				event: "checkpoint.snapshot",
				properties: {
					sessionId: options.sessionId,
					runCount,
					outcome,
					durationMs: Date.now() - startedAt,
				},
			});
		};

		const createHeadCheckpoint = async (
			warnPrefix: string,
		): Promise<CheckpointEntry | undefined> => {
			try {
				const result = await runGit(options.cwd, ["rev-parse", "HEAD"]);
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
		let ref = "";
		try {
			ref =
				(await createWorktreeStashCommit(
					options.cwd,
					checkpointScratchDir(options.sessionId),
					message,
				)) ?? "";
		} catch (error) {
			warn(
				options.logger,
				`Checkpoint snapshot failed after ${Date.now() - startedAt}ms: ${error instanceof Error ? error.message : String(error)}`,
			);
			const fallback = await createHeadCheckpoint(
				"Checkpoint HEAD fallback failed",
			);
			captureSnapshot(fallback ? "head_fallback" : "skipped");
			return fallback;
		}
		if (!ref) {
			// A clean worktree with no untracked files — the HEAD entry is the
			// expected result here, not a degradation.
			const fallback = await createHeadCheckpoint(
				"Checkpoint HEAD fallback failed",
			);
			captureSnapshot(fallback ? "head_clean" : "skipped");
			return fallback;
		}

		// Store the stash commit under a private ref namespace so it is
		// invisible to the user's normal `git stash list` workflow.
		// `refs/stash` is what populates that list; writing to any other
		// ref path keeps the object reachable (GC-safe) without surfacing
		// it to the user.  The raw SHA already works with `git stash apply`
		// on the restore path, so no restore-side changes are needed.
		const privateRef = `refs/cline/checkpoints/${options.sessionId}/${runCount}`;
		try {
			await runGit(options.cwd, ["update-ref", privateRef, ref]);
		} catch (error) {
			warn(
				options.logger,
				`Checkpoint store failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			captureSnapshot("skipped");
			return undefined;
		}

		captureSnapshot("stash");
		return {
			ref,
			createdAt: Date.now(),
			runCount,
			kind: "stash",
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
