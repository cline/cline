import type { AgentResult } from "@cline/shared";
import { nanoid } from "nanoid";
import type { ComputerTaskArtifactRecorder } from "../computer-observability/recorder";

/**
 * Owns the asynchronous "computer user" helper on behalf of a driver agent.
 *
 * The helper is a persistent, interactive session on a separately configured
 * provider (e.g. Anthropic/Sonnet while the driver runs GPT). Driver-facing
 * commands (start/status/message/interrupt) return immediately; the helper's
 * turn runs in the background and reports back through terminal collaboration
 * tools (`ask_driver`, `finish_computer_task`) plus non-terminal notes
 * (`post_driver_update`).
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

/** Injects a message into the driver's conversation (steer or queue). */
export type DriverNotifier = (input: {
	prompt: string;
	delivery: "queue" | "steer";
}) => void;

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

export interface HelperNote {
	text: string;
	kind: "progress" | "observation" | "warning";
	reportedAt: number;
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

export interface ComputerUserStatus {
	state: ComputerUserState["kind"];
	sessionId?: string;
	runId?: string;
	latestNote?: HelperNote & { ageSeconds: number };
	pendingQuestion?: DriverQuestion;
	lastMeaningfulProgressAt?: number;
	/** Human-readable one-liner for the driver's tool result. */
	summary: string;
}

export interface ComputerUserCoordinatorOptions {
	host: ComputerUserSessionHost;
	/** Fully-resolved helper session config (provider, tools, prompt). */
	helperConfig: Record<string, unknown>;
	notifyDriver: DriverNotifier;
	recorder?: ComputerTaskArtifactRecorder;
	now?: () => number;
}

export class ComputerUserCoordinator {
	private state: ComputerUserState = { kind: "uninitialized" };
	private latestNote: HelperNote | undefined;
	private lastMeaningfulProgressAt: number | undefined;
	private pendingQuestion: DriverQuestion | undefined;
	private finalReport: { result: string; observations: string[] } | undefined;
	/** Serializes all state transitions; the background run stays outside it. */
	private transitionQueue: Promise<unknown> = Promise.resolve();
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
			this.markProgress();
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
					this.markProgress();
					this.recordStatusChange("running");
					this.launchRun(sessionId, run);
					return { delivered: "new_turn" as const };
				}
			}
		});
	}

	/**
	 * Hard interruption: aborts the active run. The helper session and
	 * transcript are preserved; the run settles as aborted via settleRun.
	 */
	async interrupt(reason?: string): Promise<{ interrupted: boolean }> {
		return this.transition(async () => {
			if (this.state.kind !== "running") {
				return { interrupted: false };
			}
			const { sessionId, run } = this.state;
			this.state = { kind: "cancelling", sessionId, run };
			this.recordStatusChange("cancelling");
			await this.options.host.abort(
				sessionId,
				new Error(reason ?? "Interrupted by driver"),
			);
			return { interrupted: true };
		});
	}

	status(): ComputerUserStatus {
		const noteAge = this.latestNote
			? Math.max(
					0,
					Math.round((this.now() - this.latestNote.reportedAt) / 1000),
				)
			: undefined;
		return {
			state: this.state.kind,
			sessionId: "sessionId" in this.state ? this.state.sessionId : undefined,
			runId: "run" in this.state ? this.state.run.runId : undefined,
			latestNote:
				this.latestNote && noteAge !== undefined
					? { ...this.latestNote, ageSeconds: noteAge }
					: undefined,
			pendingQuestion:
				this.state.kind === "waiting_for_driver"
					? this.state.question
					: undefined,
			lastMeaningfulProgressAt: this.lastMeaningfulProgressAt,
			summary: this.buildSummary(noteAge),
		};
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

	// -----------------------------------------------------------------------
	// Helper-facing callbacks (wired into the helper's collaboration tools)
	// -----------------------------------------------------------------------

	/** Called by the helper's `post_driver_update` tool. */
	onHelperNote(note: Omit<HelperNote, "reportedAt">): void {
		this.latestNote = { ...note, reportedAt: this.now() };
		this.markProgress();
		this.record("helper.note", { kind: note.kind, message: note.text });
		if (note.kind === "warning") {
			this.options.notifyDriver({
				prompt: `[COMPUTER USER WARNING] ${note.text}`,
				delivery: "steer",
			});
		}
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
		this.markProgress();
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
		this.markProgress();
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
		void this.options.host.send({ sessionId, prompt: run.prompt }).then(
			(result) => this.settleRun(run, result, undefined),
			(error) =>
				this.settleRun(
					run,
					undefined,
					error instanceof Error ? error : new Error(String(error)),
				),
		);
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
	): void {
		void this.transition(async () => {
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
				this.options.notifyDriver({
					prompt:
						"[COMPUTER USER] The computer user was interrupted and is now idle.",
					delivery: "steer",
				});
				return;
			}
			if (error || result?.finishReason === "error") {
				const message = error?.message ?? result?.text ?? "Unknown error";
				this.state = { kind: "failed", sessionId, error: message };
				this.recordStatusChange("failed");
				this.options.notifyDriver({
					prompt: `[COMPUTER USER FAILED] ${message}`,
					delivery: "steer",
				});
				return;
			}
			if (question) {
				this.state = { kind: "waiting_for_driver", sessionId, question };
				this.recordStatusChange("waiting_for_driver");
				this.options.notifyDriver({
					prompt: formatQuestionForDriver(question),
					delivery: "steer",
				});
				return;
			}
			this.state = { kind: "idle", sessionId };
			this.recordStatusChange("idle");
			this.options.notifyDriver({
				prompt: formatCompletionForDriver(report, result),
				delivery: "steer",
			});
		});
	}

	private transition<T>(fn: () => Promise<T>): Promise<T> {
		const next = this.transitionQueue.then(fn, fn);
		// Keep the queue alive across failures without suppressing the
		// caller's rejection.
		this.transitionQueue = next.catch(() => {});
		return next;
	}

	private markProgress(): void {
		this.lastMeaningfulProgressAt = this.now();
	}

	private buildSummary(noteAgeSeconds: number | undefined): string {
		const note = this.latestNote;
		const noteLine =
			note && noteAgeSeconds !== undefined
				? `The computer user reported: "${note.text}" ${noteAgeSeconds} seconds ago.`
				: "The computer user has not posted an update yet.";
		switch (this.state.kind) {
			case "uninitialized":
				return "The computer user has not been started.";
			case "running":
				return `${noteLine} Status: working.`;
			case "waiting_for_driver":
				return `${noteLine} Status: waiting for your answer to a question.`;
			case "cancelling":
				return `${noteLine} Status: being interrupted.`;
			case "failed":
				return `${noteLine} Status: failed.`;
			case "idle":
				return `${noteLine} Status: idle.`;
			case "disposed":
				return "The computer user has been shut down.";
		}
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
