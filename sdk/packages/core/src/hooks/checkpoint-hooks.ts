import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AgentHooks, BasicLogger } from "@bedrock-coder/shared";

const execFile = promisify(execFileCallback);

export interface CheckpointEntry {
	schemaVersion?: 2;
	checkpointId?: string;
	ref: string;
	createdAt: number;
	runCount: number;
	kind?: "stash" | "commit";
	sessionId?: string;
	workspaceRoot?: string;
	gitBase?: string;
	gitHead?: string;
	label?: string;
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
	 * Starting value for the internal run counter. Use this when a session
	 * is created with initial messages (e.g. after a checkpoint restore) so
	 * that new checkpoint entries get runCount values that don't collide
	 * with entries carried over from the source session.
	 */
	initialRunCount?: number;
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
	env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string }> {
	const result = await execFile("git", ["-C", cwd, ...args], {
		windowsHide: true,
		...(env ? { env } : {}),
	});
	return {
		stdout: result.stdout.trim(),
		stderr: result.stderr.trim(),
	};
}

/**
 * Deletes all private git refs under refs/bedrock-coder/checkpoints/{sessionId}/ that
 * were created by the checkpoint system to keep stash objects reachable.
 * Errors are swallowed - if the cwd is not a git repo or the refs don't exist,
 * the delete is a no-op.
 */
export async function deleteCheckpointRefs(
	cwd: string | null | undefined,
	sessionId: string,
): Promise<void> {
	if (!cwd) return;
	const prefix = `refs/bedrock-coder/checkpoints/${sessionId}/`;
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
				`refs/bedrock-coder/checkpoints/${sessionId}/${entry.runCount}`,
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
	let runCount = options.initialRunCount ?? 0;
	let repoSupported: boolean | undefined;

	const ensureGitRepository = async (): Promise<boolean> => {
		if (repoSupported !== undefined) {
			return repoSupported;
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

	const createCheckpoint = async (): Promise<CheckpointEntry | undefined> => {
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
				const result = await runGit(options.cwd, ["rev-parse", "HEAD"]);
				const ref = result.stdout.trim();
				if (!ref) {
					return undefined;
				}
				return {
					schemaVersion: 2,
					checkpointId: `${options.sessionId}:${runCount}`,
					ref,
					createdAt: Date.now(),
					runCount,
					kind: "commit",
					sessionId: options.sessionId,
					workspaceRoot: options.cwd,
					gitBase: ref,
					gitHead: ref,
					label: `Before run ${runCount}`,
				};
			} catch (error) {
				warn(
					options.logger,
					`${warnPrefix}: ${error instanceof Error ? error.message : String(error)}`,
				);
				return undefined;
			}
		};

		const message = `bedrockCoder checkpoint session=${options.sessionId} run=${runCount}`;
		let ref = "";
		try {
			const untracked = await runGit(options.cwd, [
				"ls-files",
				"--others",
				"--exclude-standard",
			]);
			if (!untracked.stdout.trim()) {
				const result = await runGit(options.cwd, [
					"stash",
					"create",
					message,
				]);
				ref = result.stdout.trim();
			} else {
				const temporaryDirectory = await mkdtemp(
					join(tmpdir(), "bedrock-coder-checkpoint-index-"),
				);
				try {
					const env = {
						...process.env,
						GIT_INDEX_FILE: join(temporaryDirectory, "index"),
					};
					const head = await runGit(options.cwd, ["rev-parse", "HEAD"]);
					await runGit(options.cwd, ["read-tree", head.stdout], env);
					await runGit(options.cwd, ["add", "-A", "--", "."], env);
					const tree = await runGit(options.cwd, ["write-tree"], env);
					const commit = await runGit(
						options.cwd,
						[
							"commit-tree",
							tree.stdout,
							"-p",
							head.stdout,
							"-m",
							message,
						],
						env,
					);
					ref = commit.stdout.trim();
				} finally {
					await rm(temporaryDirectory, {
						recursive: true,
						force: true,
					}).catch(() => {});
				}
			}
		} catch (error) {
			warn(
				options.logger,
				`Checkpoint snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return createHeadCheckpoint("Checkpoint HEAD fallback failed");
		}
		if (!ref) {
			return createHeadCheckpoint("Checkpoint HEAD fallback failed");
		}

		// Store the stash commit under a private ref namespace so it is
		// invisible to the user's normal `git stash list` workflow.
		// `refs/stash` is what populates that list; writing to any other
		// ref path keeps the object reachable (GC-safe) without surfacing
		// it to the user.  The raw SHA already works with `git stash apply`
		// on the restore path, so no restore-side changes are needed.
		const privateRef = `refs/bedrock-coder/checkpoints/${options.sessionId}/${runCount}`;
		try {
			await runGit(options.cwd, ["update-ref", privateRef, ref]);
		} catch (error) {
			warn(
				options.logger,
				`Checkpoint store failed: ${error instanceof Error ? error.message : String(error)}`,
			);
			return undefined;
		}

		return {
			schemaVersion: 2,
			checkpointId: `${options.sessionId}:${runCount}`,
			ref,
			createdAt: Date.now(),
			runCount,
			kind: "stash",
			sessionId: options.sessionId,
			workspaceRoot: options.cwd,
			gitBase: await runGit(options.cwd, ["rev-parse", "HEAD"])
				.then((result) => result.stdout)
				.catch(() => undefined),
			gitHead: await runGit(options.cwd, ["rev-parse", "HEAD"])
				.then((result) => result.stdout)
				.catch(() => undefined),
			label: `Before run ${runCount}`,
		};
	};

	return {
		beforeRun: async ({ snapshot }) => {
			if (snapshot.parentAgentId != null) {
				return undefined;
			}
			runCount += 1;
			return undefined;
		},
		beforeModel: async ({ snapshot }) => {
			if (
				snapshot.parentAgentId != null ||
				snapshot.iteration !== 1 ||
				runCount < 1
			) {
				return undefined;
			}
			const entry = await createCheckpoint();
			if (!entry) {
				return undefined;
			}
			const metadata = await options.readSessionMetadata();
			const existing = readCheckpointMetadata(metadata);
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
