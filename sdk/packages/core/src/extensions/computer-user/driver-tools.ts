import type { AgentTool } from "@cline/shared";
import { createTool, zodToJsonSchema } from "@cline/shared";
import { z } from "zod";
import type { ComputerBackendEnsureResult } from "../computer-use/backend-restart";
import type { ComputerUserCoordinator } from "./coordinator";

/**
 * Driver-facing tools for delegating GUI work to the asynchronous computer
 * user. Start and message return without waiting for the helper's turn;
 * interrupt returns after the active turn is quiescent. Status can return
 * immediately or wait for a bounded change. Transcript peeks the helper's
 * recent activity; restart recreates a degraded helper session. Results,
 * questions, and warnings also arrive as steer messages injected into the
 * driver's conversation. The tools are separate (rather than one action
 * union) because their approval semantics differ: hosts typically
 * auto-approve status and transcript checks while gating start/interrupt/
 * restart.
 */

const StartInput = z
	.object({
		task: z
			.string()
			.trim()
			.min(1)
			.describe(
				"The task to delegate. Include the goal, any constraints, and what evidence you need back.",
			),
	})
	.strict();

const MessageInput = z
	.object({
		message: z
			.string()
			.trim()
			.min(1)
			.describe(
				"Guidance, an answer to the computer user's question, or a follow-up task.",
			),
	})
	.strict();

const InterruptInput = z
	.object({
		reason: z
			.string()
			.trim()
			.min(1)
			.optional()
			.describe("Why the work should stop. Shown to the computer user."),
	})
	.strict();

const MAX_STATUS_WAIT_SECONDS = 120;
const StatusInput = z
	.object({
		since: z
			.number()
			.int()
			.nonnegative()
			.optional()
			.describe(
				"Revision returned by a previous status call. Returns immediately if status has changed since this revision.",
			),
		timeout: z
			.number()
			.nonnegative()
			.max(MAX_STATUS_WAIT_SECONDS)
			.optional()
			.describe(
				`Maximum seconds to wait for a change when since is current (0-${MAX_STATUS_WAIT_SECONDS}). Requires since.`,
			),
	})
	.strict()
	.refine((input) => input.timeout === undefined || input.since !== undefined, {
		message: "timeout requires since",
		path: ["timeout"],
	});

const MAX_TRANSCRIPT_LIMIT = 100;
const TranscriptInput = z
	.object({
		limit: z
			.number()
			.int()
			.min(1)
			.max(MAX_TRANSCRIPT_LIMIT)
			.optional()
			.describe(
				`Maximum entries to return (1-${MAX_TRANSCRIPT_LIMIT}). Default 50.`,
			),
		sinceSeq: z
			.number()
			.int()
			.nonnegative()
			.optional()
			.describe(
				"Sequence cursor from a previous transcript call: skip entries up to and including it, returning only newer activity.",
			),
	})
	.strict();

const RestartInput = z
	.object({
		reason: z
			.string()
			.trim()
			.min(1)
			.optional()
			.describe(
				"Why the helper is being restarted. Kept with the session's ended record.",
			),
	})
	.strict();

const BackendRestartInput = z.object({}).strict();

/**
 * The backend restart capability the tool needs. `ComputerBackendRestart`
 * satisfies this structurally; hosts and tests may substitute their own.
 */
export interface ComputerBackendRestartCapability {
	/** Overall wait budget; the tool's timeout is sized from it. */
	budgetMs: number;
	ensureRunning(signal?: AbortSignal): Promise<ComputerBackendEnsureResult>;
	dispose(): Promise<void>;
}

/** Optional capabilities the host can wire into the driver tool set. */
export interface ComputerUserDriverToolOptions {
	/**
	 * Backend restart support. Provided only when the host also configured a
	 * launch command; when present the driver gets
	 * `computer_user_restart_backend`.
	 */
	backendRestart?: ComputerBackendRestartCapability;
}

/** Builds the driver-facing computer-user tools bound to one coordinator. */
export function createComputerUserDriverTools(
	coordinator: ComputerUserCoordinator,
	options?: ComputerUserDriverToolOptions,
): AgentTool[] {
	const start = createTool({
		name: "computer_user_start",
		description:
			"Delegate a task requiring GUI/computer interaction to the computer user, a separate agent controlling a computer environment. Returns immediately; you will be notified in this conversation when it finishes, fails, or has a question. Continue with other work meanwhile, or poll computer_user_status.",
		inputSchema: zodToJsonSchema(StartInput),
		retryable: false,
		execute: async (input: unknown) => {
			const parsed = StartInput.parse(input);
			const { sessionId, runId } = await coordinator.start(parsed.task);
			return {
				status: "started",
				sessionId,
				runId,
				note: "The computer user is working in the background. You will be notified here when it reports.",
			};
		},
	});

	const status = createTool({
		name: "computer_user_status",
		description:
			"Get the computer user's current state, latest update, and revision. To wait without polling, pass the revision from a previous response as since plus a timeout in seconds. Returns immediately if the revision has already changed; otherwise waits until a change or timeout.",
		inputSchema: zodToJsonSchema(StatusInput),
		timeoutMs: (MAX_STATUS_WAIT_SECONDS + 5) * 1000,
		retryable: false,
		execute: async (input: unknown, context) => {
			const parsed = StatusInput.parse(input);
			return parsed.since === undefined
				? coordinator.status()
				: coordinator.waitForStatus(
						parsed.since,
						(parsed.timeout ?? 0) * 1000,
						context.signal,
					);
		},
	});

	const message = createTool({
		name: "computer_user_message",
		description:
			"Send a message to the computer user: answer its question, adjust its instructions mid-task, or give it a follow-up task in the same session. Steers a running task at its next step; starts a new turn when it is idle or waiting. Returns immediately.",
		inputSchema: zodToJsonSchema(MessageInput),
		retryable: false,
		execute: async (input: unknown) => {
			const parsed = MessageInput.parse(input);
			const { delivered } = await coordinator.message(parsed.message);
			return {
				status: "delivered",
				delivered,
				note:
					delivered === "steer"
						? "The computer user will see this at its next step."
						: "The computer user started a new turn with this message.",
			};
		},
	});

	const interrupt = createTool({
		name: "computer_user_interrupt",
		description:
			"Stop the computer user's current work and wait until it is idle. Its session and memory of the task survive; send computer_user_message afterwards to redirect it. An input action already delivered to the computer may still take effect.",
		inputSchema: zodToJsonSchema(InterruptInput),
		retryable: false,
		execute: async (input: unknown) => {
			const parsed = InterruptInput.parse(input);
			const { interrupted } = await coordinator.interrupt(parsed.reason);
			return interrupted
				? {
						status: "stopped",
						note: "The computer user is idle and can accept a new turn.",
					}
				: {
						status: "not_running",
						note: "The computer user was not running; nothing to interrupt.",
					};
		},
	});

	const transcript = createTool({
		name: "computer_user_transcript",
		description:
			"Read the computer user's recent transcript: its reasoning, the tool calls it made (name and input), their results, its messages to the user, and its final reports. Use this to see what it actually did (including when a run ends without a structured report), to answer 'is it done?', or to page new activity with sinceSeq. Entries keep the session id they belong to, so history before a restart is distinguishable from the new session.",
		inputSchema: zodToJsonSchema(TranscriptInput),
		retryable: true,
		execute: async (input: unknown) => {
			const parsed = TranscriptInput.parse(input);
			const tail = coordinator.transcriptTail(parsed);
			return (
				tail ?? {
					entries: [],
					latestSeq: 0,
					note: "Transcript recording is not enabled on this host.",
				}
			);
		},
	});

	const restart = createTool({
		name: "computer_user_restart",
		description:
			"Recreate the computer user: abort its active run, stop its session, and reset it to a clean state for when it degrades (e.g. turns that end in seconds without acting, or reports that never arrive). Call computer_user_start afterwards to create a fresh session that retains no memory of previous tasks. Its transcript history survives, tagged with the old session id. This restarts the helper, not the computer-use backend — use computer_user_restart_backend for that.",
		inputSchema: zodToJsonSchema(RestartInput),
		retryable: false,
		execute: async (input: unknown) => {
			const parsed = RestartInput.parse(input);
			const { restarted } = await coordinator.restart(parsed.reason);
			return restarted
				? {
						status: "restarted",
						note: "The computer user is clean and uninitialized. Call computer_user_start to create a fresh session with no memory of previous tasks.",
					}
				: {
						status: "not_restarted",
						note: "The computer user has been disposed; nothing to restart.",
					};
		},
	});

	const tools: AgentTool[] = [
		start,
		status,
		message,
		interrupt,
		transcript,
		restart,
	];

	if (options?.backendRestart) {
		const backendRestart = options.backendRestart;
		tools.push(
			createTool({
				name: "computer_user_restart_backend",
				description:
					"Bring the computer-use backend (the process behind the computer tool and the computer user) back when it is unreachable — e.g. after it crashed or was killed. Probes it first: if it answers, reports already_running without touching it. If it is down, launches the configured backend command and waits for it to answer. Does not kill a backend it did not spawn.",
				inputSchema: zodToJsonSchema(BackendRestartInput),
				// The wait budget plus probe slack, so the tool outlives a slow launch (e.g. a cargo build).
				timeoutMs: backendRestart.budgetMs + 60_000,
				retryable: false,
				execute: async (input: unknown, context) => {
					BackendRestartInput.parse(input);
					const result = await backendRestart.ensureRunning(context.signal);
					switch (result.status) {
						case "already_running":
							return {
								status: result.status,
								note: "The backend answered a probe; it is running. Nothing was launched.",
							};
						case "started":
							return {
								status: result.status,
								note: "The backend was down and has been launched. The next computer action reconnects automatically.",
							};
						case "failed_to_start":
							return {
								status: result.status,
								error: result.error,
								note: "Backend recovery did not complete. Read the error before retrying; the command may not have been launched.",
							};
					}
				},
			}),
		);
	}

	return tools;
}
