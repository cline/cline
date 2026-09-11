import type { AgentResult } from "@cline/shared";
import { nanoid } from "nanoid";
import type { ComputerTaskArtifactRecorder } from "../computer-observability/recorder";
import type {
	ComputerUserTranscriptEntry,
	ComputerUserTranscriptLog,
} from "./transcript-log";

/**
 * Owns the asynchronous "computer user" helper on behalf of a driver agent.
 *
 * The helper is a persistent, interactive session on a separately configured
 * provider (e.g. Anthropic/Sonnet while the driver runs GPT). Driver-facing
 * commands start and steer the helper without waiting for its turn; interruption
 * waits until the active helper run is quiescent. The helper reports back through
 * terminal collaboration tools (`ask_driver`, `finish_computer_task`) plus
 * non-terminal notes (`post_driver_update`).
 *
 * Consistency boundary: the helper's provider profile, tool inventory, and
 * system prompt become effective together when the helper session is created
 * and do not change for its lifetime. All state transitions are serialized
 * through `transition()`; the background run never mutates state directly —
 * it settles through `settleRun()`, which ignores stale runs by identity.
 */

// ---------------------------------------------------------------------------
// Host surface
// ---------------------------------------------------------------------------

/**
 * The slice of a session host the coordinator needs. `ClineCore` satisfies
 * this structurally; tests supply a fake that exercises the same contract.
 */
export interface ComputerUserSessionHost {
	start(input: {
		config: Record<string, unknown>;
		interactive: boolean;
	}): Promise<{ sessionId: string }>;
	send(input: {
		sessionId: string;
		prompt: string;
		delivery?: "queue" | "steer";
	}): Promise<AgentResult | undefined>;
	abort(sessionId: string, reason?: unknown): Promise<void>;
	stop(sessionId: string): Promise<void>;
}

/** Emits a steer message that wakes the driver's conversation. */
export type DriverNotifier = (prompt: string) => void;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export interface HelperNote {
	text: string;
	kind: "progress" | "observation" | "warning";
}

export interface DriverQuestion {
	question: string;
	context: string;
	options?: string[];
	askedAt: number;
	eventId: string;
}

export interface HelperRun {
	runId: string;
	startedAt: number;
	prompt: string;
}

export type ComputerUserState =
	| { kind: "uninitialized" }
	| { kind: "idle"; sessionId: string }
	| { kind: "running"; sessionId: string; run: HelperRun }
	| { kind: "waiting_for_driver"; sessionId: string; question: DriverQuestion }
	| { kind: "cancelling"; sessionId: string; run: HelperRun }
	| { kind: "failed"; sessionId: string; error: string }
	| { kind: "disposed" };

export interface ComputerUserCoordinatorOptions {
	host: ComputerUserSessionHost;
	/** Fully-resolved helper session config (provider, tools, prompt). */
	helperConfig: Record<string, unknown>;
	emitSteerMessage: DriverNotifier;
	recorder?: ComputerTaskArtifactRecorder;
	/** In-process tail of the helper's transcript, for the driver's peek tool. */
	transcriptLog?: ComputerUserTranscriptLog;
	now?: () => number;
}

export class ComputerUserCoordinator {
	private state: ComputerUserState = { kind: "uninitialized" };
	private pendingQuestion: DriverQuestion | undefined;
	private finalReport: { result: string; observations: string[] } | undefined;
	/** Serializes all state transitions; the background run stays outside it. */
	private transitionQueue: Promise<unknown> = Promise.resolve();
	/** Resolves after each run's serialized settlement has completed. */
	private readonly runSettlements = new WeakMap<HelperRun, Promise<void>>();
	private readonly now: () => number;

	constructor(private readonly options: ComputerUserCoordinatorOptions) {
		this.now = options.now ?? Date.now;
	}

	getState(): ComputerUserState {
		return this.state;
	}

	// -----------------------------------------------------------------------
	// Driver-facing commands
	// -----------------------------------------------------------------------

	/** Starts a helper run in the background and returns immediately. */
	async start(task: string): Promise<{ sessionId: string; runId: string }> {
		return this.transition(async () => {
			if (this.state.kind === "disposed") {
				throw new Error("Computer user has been disposed");
			}
			if (this.state.kind === "running" || this.state.kind === "cancelling") {
				throw new Error(
					"Computer user is busy; interrupt it or wait for it to finish",
				);
			}
			const sessionId = await this.ensureSession();
			const run: HelperRun = {
				runId: `curun_${nanoid(8)}`,
				startedAt: this.now(),
				prompt: task,
			};
			this.state = { kind: "running", sessionId, run };
			this.recordStatusChange("running");
			this.launchRun(sessionId, run);
			return { sessionId, runId: run.runId };
		});
	}

	/**
	 * Sends a driver message to the helper. Steers a running helper at its
	 * next model boundary; answers a pending question or starts a new turn
	 * when the helper is idle/waiting/failed.
	 */
	async message(text: string): Promise<{ delivered: "steer" | "new_turn" }> {
		return this.transition(async () => {
			switch (this.state.kind) {
				case "disposed":
					throw new Error("Computer user has been disposed");
				case "uninitialized":
					throw new Error("Computer user has not been started");
				case "cancelling":
					throw new Error(
						"Computer user is being interrupted; retry after it settles",
					);
				case "running": {
					await this.options.host.send({
						sessionId: this.state.sessionId,
						prompt: text,
						delivery: "steer",
					});
					return { delivered: "steer" as const };
				}
				case "idle":
				case "waiting_for_driver":
				case "failed": {
					const sessionId = this.state.sessionId;
					const run: HelperRun = {
						runId: `curun_${nanoid(8)}`,
						startedAt: this.now(),
						prompt: text,
					};
					this.state = { kind: "running", sessionId, run };
					this.recordStatusChange("running");
					this.launchRun(sessionId, run);
					return { delivered: "new_turn" as const };
				}
			}
		});
	}

	/**
	 * Aborts the active run and returns only after that exact run is quiescent.
	 * The helper session and transcript are preserved for a later turn.
	 */
	async interrupt(reason?: string): Promise<{ interrupted: boolean }> {
		const interruption = await this.transition(async () => {
			if (this.state.kind !== "running") {
				return undefined;
			}
			const { sessionId, run } = this.state;
			const settlement = this.runSettlements.get(run);
			if (!settlement) {
				throw new Error("Computer user run settlement is unavailable");
			}
			this.state = { kind: "cancelling", sessionId, run };
			this.recordStatusChange("cancelling");
			return { sessionId, run, settlement };
		});
		if (!interruption) {
			return { interrupted: false };
		}
		try {
			await this.options.host.abort(
				interruption.sessionId,
				new Error(reason ?? "Interrupted by driver"),
			);
		} catch (error) {
			await this.transition(async () => {
				const current = this.state;
				if (current.kind === "cancelling" && current.run === interruption.run) {
					// The host did not establish quiescence, so keep the run retryably
					// active rather than claiming that interruption succeeded.
					this.state = {
						kind: "running",
						sessionId: interruption.sessionId,
						run: interruption.run,
					};
					this.recordStatusChange("running");
				}
			});
			throw error;
		}
		// Consistency boundary: the driver regains control only after the
		// targeted run has settled through the serialized state machine.
		await interruption.settlement;
		return { interrupted: true };
	}

	/** Aborts active work, stops the helper session, and releases resources. */
	async dispose(): Promise<void> {
		await this.transition(async () => {
			if (this.state.kind === "disposed") {
				return;
			}
			const sessionId =
				"sessionId" in this.state ? this.state.sessionId : undefined;
			if (sessionId) {
				if (this.state.kind === "running") {
					await this.options.host
						.abort(sessionId, new Error("Computer user disposed"))
						.catch(() => {});
				}
				await this.options.host.stop(sessionId).catch(() => {});
			}
			this.state = { kind: "disposed" };
			this.recordStatusChange("disposed");
		});
	}

	/**
	 * Resets the helper for a degraded session: aborts any active run, stops
	 * the helper session, and returns the coordinator to `uninitialized`. The
	 * next start creates a fresh session — the helper retains no
	 * memory of previous tasks, and its transcript log keeps the old
	 * session's entries (tagged with the old session id) as history.
	 *
	 * Like `dispose`, the run's in-flight settlement is ignored afterwards by
	 * state-kind check in `settleRun`, so a wedged turn cannot resurrect old
	 * state. This restarts the helper session, not the computer-use backend.
	 */
	async restart(reason?: string): Promise<{ restarted: boolean }> {
		return this.transition(async () => {
			if (this.state.kind === "disposed") {
				return { restarted: false };
			}
			const sessionId =
				"sessionId" in this.state ? this.state.sessionId : undefined;
			if (sessionId) {
				if (this.state.kind === "running") {
					await this.options.host.abort(
						sessionId,
						new Error(reason ?? "Restarted by driver"),
					);
				}
				await this.options.host.stop(sessionId);
				this.record(
					"session.ended",
					{ reason: reason ?? "restarted_by_driver" },
					sessionId,
				);
			}
			this.state = { kind: "uninitialized" };
			this.pendingQuestion = undefined;
			this.finalReport = undefined;
			this.recordStatusChange("uninitialized");
			return { restarted: true };
		});
	}

	/**
	 * Recent helper transcript entries from the in-process log, or undefined
	 * when the host did not enable transcript recording.
	 */
	transcriptTail(options?: {
		limit?: number;
		sinceSeq?: number;
	}):
		| { entries: ComputerUserTranscriptEntry[]; latestSeq: number }
		| undefined {
		return this.options.transcriptLog?.tail(options);
	}

	// -----------------------------------------------------------------------
	// Helper-facing callbacks (wired into the helper's collaboration tools)
	// -----------------------------------------------------------------------

	/** Called by the helper's `post_driver_update` tool. */
	onHelperNote(note: HelperNote): void {
		this.record("helper.note", { kind: note.kind, message: note.text });
		this.options.emitSteerMessage(
			`[COMPUTER USER ${note.kind.toUpperCase()}] ${note.text}`,
		);
	}

	/**
	 * Called by the helper's terminal `ask_driver` tool. The tool has
	 * `completesRun`, so the run ends after this; settleRun observes the
	 * stashed question and parks the state at `waiting_for_driver`.
	 */
	onHelperQuestion(input: {
		question: string;
		context: string;
		options?: string[];
	}): DriverQuestion {
		const question: DriverQuestion = {
			...input,
			askedAt: this.now(),
			eventId: `evt_${nanoid(12)}`,
		};
		this.pendingQuestion = question;
		this.record("helper.question", {
			question: input.question,
			context: input.context,
			options: input.options,
		});
		return question;
	}

	/** Called by the helper's terminal `finish_computer_task` tool. */
	onHelperFinish(report: { result: string; observations: string[] }): void {
		this.finalReport = report;
	}

	// -----------------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------------

	private async ensureSession(): Promise<string> {
		if ("sessionId" in this.state) {
			return this.state.sessionId;
		}
		const { sessionId } = await this.options.host.start({
			config: this.options.helperConfig,
			interactive: true,
		});
		this.record("session.started", { role: "computer_user" }, sessionId);
		return sessionId;
	}

	/**
	 * Fire-and-forget launch. The rejection observer is attached before this
	 * returns so a fast failure can never become an unhandled rejection.
	 */
	private launchRun(sessionId: string, run: HelperRun): void {
		const settlement = this.options.host
			.send({ sessionId, prompt: run.prompt })
			.then(
				(result) => this.settleRun(run, result, undefined),
				(error) =>
					this.settleRun(
						run,
						undefined,
						error instanceof Error ? error : new Error(String(error)),
					),
			);
		this.runSettlements.set(run, settlement);
		// Normal runs have no foreground waiter. Keep settlement failures from
		// becoming process-level unhandled rejections without hiding them from
		// an interrupt caller that awaits the original promise.
		void settlement.catch(() => {});
	}

	/**
	 * Settles a background run. Stale settlements (a different run is now
	 * active, or the coordinator was disposed) are ignored by run object
	 * identity — never by comparing runId strings against rebuilt state.
	 */
	private settleRun(
		run: HelperRun,
		result: AgentResult | undefined,
		error: Error | undefined,
	): Promise<void> {
		return this.transition(async () => {
			const current = this.state;
			if (
				(current.kind !== "running" && current.kind !== "cancelling") ||
				current.run !== run
			) {
				return;
			}
			const sessionId = current.sessionId;
			const question = this.pendingQuestion;
			this.pendingQuestion = undefined;
			const report = this.finalReport;
			this.finalReport = undefined;

			if (current.kind === "cancelling" || result?.finishReason === "aborted") {
				this.state = { kind: "idle", sessionId };
				this.recordStatusChange("idle");
				return;
			}
			if (error || result?.finishReason === "error") {
				const message = error?.message ?? result?.text ?? "Unknown error";
				this.state = { kind: "failed", sessionId, error: message };
				this.recordStatusChange("failed");
				this.options.emitSteerMessage(`[COMPUTER USER FAILED] ${message}`);
				return;
			}
			if (question) {
				this.state = { kind: "waiting_for_driver", sessionId, question };
				this.recordStatusChange("waiting_for_driver");
				this.options.emitSteerMessage(formatQuestionForDriver(question));
				return;
			}
			this.state = { kind: "idle", sessionId };
			this.recordStatusChange("idle");
			this.options.emitSteerMessage(formatCompletionForDriver(report, result));
		});
	}

	private transition<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.transitionQueue.then(fn, fn);
		// Keep the queue alive across failures without suppressing the
		// caller's rejection.
		this.transitionQueue = next.catch(() => {});
		return next;
	}

	private record(
		type: Parameters<ComputerTaskArtifactRecorder["record"]>[0]["type"],
		payload: Record<string, unknown>,
		sessionId?: string,
	): void {
		this.options.recorder?.record({
			type,
			source: {
				kind: "coordinator",
				sessionId:
					sessionId ??
					("sessionId" in this.state ? this.state.sessionId : undefined),
			},
			payload,
		});
	}

	private recordStatusChange(to: ComputerUserState["kind"]): void {
		this.record("helper.status_changed", { to });
	}
}

function formatQuestionForDriver(question: DriverQuestion): string {
	const lines = [
		"[COMPUTER USER QUESTION]",
		question.question,
		"",
		`Context: ${question.context}`,
	];
	if (question.options && question.options.length > 0) {
		lines.push(`Options: ${question.options.join(" | ")}`);
	}
	lines.push(
		"",
		"Reply with the computer_user message tool to answer and resume the task.",
	);
	return lines.join("\n");
}

function formatCompletionForDriver(
	report: { result: string; observations: string[] } | undefined,
	result: AgentResult | undefined,
): string {
	if (report) {
		const lines = ["[COMPUTER USER DONE]", report.result];
		if (report.observations.length > 0) {
			lines.push("", "Observations:");
			for (const observation of report.observations) {
				lines.push(`- ${observation}`);
			}
		}
		return lines.join("\n");
	}
	return `[COMPUTER USER DONE] ${result?.text ?? "The computer user finished without a structured report."}`;
}
