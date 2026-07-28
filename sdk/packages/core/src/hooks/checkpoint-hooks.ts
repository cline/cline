import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import type { AgentHooks, AgentMessage, BasicLogger } from "@cline/shared";
import { normalizeUserInput, stripModeNotices } from "@cline/shared";

const execFile = promisify(execFileCallback);

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
};

/**
 * Metadata `kind` tags that mark a `role: "user"` message as synthetic and
 * system-injected rather than typed by the user. Keep in sync with the tags
 * applied in session-runtime-orchestrator.ts, agent-runtime.ts
 * (addUserReminderMessage), and the compaction extensions.
 */
const SYNTHETIC_USER_MESSAGE_KINDS = new Set([
	"recovery_notice",
	"loop_detection_notice",
	"mistake_stop_notice",
	"completion_reminder",
	"compaction",
	"compaction_summary",
]);

/**
 * Host continuation prompts (task resumption after an interruption, the VS
 * Code plan -> act auto-continue) are sent as `role: "user"` messages but have
 * no user-authored counterpart in the visible transcript. They must not count
 * as new runs, or the recorded checkpoint numbers drift from the transcript's
 * turn ordinals and restore fails with "No checkpoint found at or before run
 * N". Persisted prompts are wrapped as `<user_input mode="...">...` and may
 * carry a `<mode_notice>` prefix, so both are stripped before matching. Keep
 * in sync with apps/vscode/src/sdk/sdk-user-message-mapping.ts.
 */
function isSyntheticContinuationPrompt(text: string): boolean {
	const normalized = stripModeNotices(normalizeUserInput(text));
	return (
		normalized.startsWith("[TASK RESUMPTION]") ||
		normalized ===
			"The user approved switching to act mode. Continue with the approved plan now."
	);
}

/**
 * A message counts as a genuine user turn only if it is user-role, not tagged
 * as a synthetic system notice, and carries visible user input (non-empty
 * text or an image/file attachment). An attachment-carrying continuation
 * prompt still counts: the host shows a bubble for the attachment.
 */
function isGenuineUserMessage(message: AgentMessage): boolean {
	if (message.role !== "user") {
		return false;
	}
	const kind = message.metadata?.kind;
	if (typeof kind === "string" && SYNTHETIC_USER_MESSAGE_KINDS.has(kind)) {
		return false;
	}
	const text = message.content
		.map((part) =>
			part.type === "text"
				? part.text.trim()
				: part.type === "file"
					? part.content.trim()
					: "",
		)
		.filter(Boolean)
		.join("\n")
		.trim();
	const hasAttachments = message.content.some(
		(part) => part.type === "image" || part.type === "file",
	);
	if (!text && !hasAttachments) {
		return false;
	}
	return hasAttachments || !isSyntheticContinuationPrompt(text);
}

function countGenuineUserMessages(messages: readonly AgentMessage[]): number {
	let count = 0;
	for (const message of messages) {
		if (isGenuineUserMessage(message)) {
			count += 1;
		}
	}
	return count;
}

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

		const message = `cline checkpoint session=${options.sessionId} run=${runCount}`;
		let ref = "";
		try {
			const result = await runGit(options.cwd, ["stash", "create", message]);
			ref = result.stdout.trim();
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
		const privateRef = `refs/cline/checkpoints/${options.sessionId}/${runCount}`;
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
			ref,
			createdAt: Date.now(),
			runCount,
			kind: "stash",
		};
	};

	return {
		// The run number is derived from the count of genuine user turns in the
		// snapshot rather than a counter incremented per run()/continue()
		// invocation: internal continuations (retries, recovery notices,
		// auto-continues) invoke the runtime without a new user turn, which
		// silently drifts a counter away from the transcript ordinals the host
		// restores by (apps/vscode/src/sdk/sdk-checkpoints.ts) and makes
		// restore fail with "No checkpoint found at or before run N".
		beforeModel: async ({ snapshot }) => {
			if (snapshot.parentAgentId != null || snapshot.iteration !== 1) {
				return undefined;
			}
			// A run triggered by a synthetic message (recovery notice, host
			// continuation prompt) is not a new user turn: the genuine count is
			// unchanged, so writing a checkpoint here would overwrite the entry
			// recorded at the start of the CURRENT turn with a snapshot of that
			// turn's half-finished workspace state.
			for (let index = snapshot.messages.length - 1; index >= 0; index -= 1) {
				const message = snapshot.messages[index];
				if (message?.role !== "user") {
					continue;
				}
				if (!isGenuineUserMessage(message)) {
					return undefined;
				}
				break;
			}
			const runCount = countGenuineUserMessages(snapshot.messages);
			if (runCount < 1) {
				return undefined;
			}
			const entry = await createCheckpoint(runCount);
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
