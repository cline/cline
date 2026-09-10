import { basename } from "node:path";
import type {
	BasicLogger,
	ChatRunTurnRequest,
	ChatStartSessionRequest,
	ITelemetryService,
} from "@cline/shared";
import { buildClineSystemPrompt } from "@cline/shared";
import { nowIso } from "@cline/shared/db";
import type { ResolveCronSpecsDirOptions } from "@cline/shared/storage";
import { DefaultToolNames } from "../../extensions/tools/constants";
import { mergeRulesForSystemPrompt } from "../../runtime/safety/rules";
import { captureScheduleRun } from "../../services/telemetry/core-events";
import { buildWorkspaceMetadata } from "../../services/workspace/workspace-manifest";
import { writeCronRunReport } from "../reports/cron-report-writer";
import type { HubScheduleRuntimeHandlers } from "../service/schedule-service";
import type {
	ClaimedCronRun,
	CronEventLogRecord,
	CronRunRecord,
	CronSpecRecord,
	SqliteCronStore,
} from "../store/sqlite-cron-store";
import type { CronMaterializer } from "./cron-materializer";

/**
 * Trigger-agnostic runner for queued cron runs.
 *
 * Polls cron.db every N seconds, atomically claims queued runs, executes
 * them through the existing runtime handlers (also used by the hub schedule
 * command adapter), persists status transitions transactionally,
 * and writes a markdown report per completion/failure.
 */

const CLEANUP_TIMEOUT_MS = 5_000;

class RunCancelledError extends Error {}

async function withCancellation<T>(
	promise: Promise<T>,
	signal: AbortSignal,
): Promise<T> {
	let onAbort: () => void = () => {};
	const cancelled = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal.reason);
		if (signal.aborted) onAbort();
		else signal.addEventListener("abort", onAbort, { once: true });
	});
	try {
		return await Promise.race([promise, cancelled]);
	} finally {
		signal.removeEventListener("abort", onAbort);
	}
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_CLAIM_LEASE_SECONDS = 90;
const DEFAULT_CRON_EXTENSIONS = ["rules", "skills", "plugins"] as const;

interface HubTurnResult {
	text: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
		totalCost?: number;
	};
	toolCalls?: Array<{
		name: string;
		error?: string;
		durationMs?: number;
	}>;
}

function cronExtensionEnabled(
	spec: CronSpecRecord,
	extension: (typeof DEFAULT_CRON_EXTENSIONS)[number],
): boolean {
	return new Set(spec.extensions ?? DEFAULT_CRON_EXTENSIONS).has(extension);
}

function buildToolPolicies(
	spec: CronSpecRecord,
	mode: "act" | "plan" | "yolo",
): NonNullable<ChatStartSessionRequest["toolPolicies"]> {
	const policies: NonNullable<ChatStartSessionRequest["toolPolicies"]> =
		spec.tools === undefined
			? { "*": { autoApprove: true } }
			: { "*": { enabled: false, autoApprove: true } };
	for (const tool of spec.tools ?? []) {
		policies[tool] = { enabled: true, autoApprove: true };
	}
	// Scheduled runs are headless, so they cannot wait for a human response.
	policies[DefaultToolNames.ASK] = {
		...policies[DefaultToolNames.ASK],
		enabled: false,
		autoApprove: true,
	};
	if (mode === "yolo") {
		policies[DefaultToolNames.SUBMIT_AND_EXIT] = {
			enabled: true,
			autoApprove: true,
		};
	}
	return policies;
}

function buildNotesSystemPromptSection(
	notesDirectory: string | undefined,
): string | undefined {
	const trimmed = notesDirectory?.trim();
	if (!trimmed) return undefined;
	return [
		"# Notes Directory",
		`Use ${trimmed} for durable notes related to this automation.`,
		"Before starting, inspect relevant existing notes there when useful. During or after the run, write concise notes there when they would help future runs continue with context.",
	].join("\n");
}

class TimeoutError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TimeoutError";
	}
}

async function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	if (timeoutMs <= 0) return promise;
	let handle: ReturnType<typeof setTimeout> | undefined;
	const timeoutPromise = new Promise<never>((_, reject) => {
		handle = setTimeout(() => {
			reject(new TimeoutError("cron run timed out"));
		}, timeoutMs);
	});
	try {
		return await Promise.race([promise, timeoutPromise]);
	} finally {
		if (handle) clearTimeout(handle);
	}
}

/**
 * Session metadata keys that identify the automation run a session belongs
 * to. Clients (e.g. the desktop sidebar) read these to group a schedule's
 * runs together and label each one, so they are part of the session
 * metadata contract; keep them in sync with the readers.
 */
export const RUN_SESSION_METADATA_KEYS = {
	scheduleId: "scheduleId",
	scheduleName: "scheduleName",
	scheduleExecutionId: "scheduleExecutionId",
	scheduleRunNumber: "scheduleRunNumber",
} as const;

export function buildRunSessionMetadata(
	spec: Pick<CronSpecRecord, "externalId" | "title">,
	run: Pick<CronRunRecord, "runId">,
	runNumber: number | undefined,
): Record<string, unknown> {
	return {
		[RUN_SESSION_METADATA_KEYS.scheduleId]: spec.externalId,
		[RUN_SESSION_METADATA_KEYS.scheduleName]: spec.title,
		[RUN_SESSION_METADATA_KEYS.scheduleExecutionId]: run.runId,
		...(runNumber !== undefined
			? { [RUN_SESSION_METADATA_KEYS.scheduleRunNumber]: runNumber }
			: {}),
	};
}

export interface CronRunnerOptions {
	store: SqliteCronStore;
	materializer: CronMaterializer;
	runtimeHandlers: HubScheduleRuntimeHandlers;
	eventPublisher?: (
		eventType: string,
		payload: Record<string, unknown>,
	) => void;
	/** Default runtime workspace for the hub/daemon process. */
	workspaceRoot: string;
	/** Cron spec source/report location. Defaults to global `~/.cline/cron`. */
	specs?: ResolveCronSpecsDirOptions;
	logger?: BasicLogger;
	telemetry?: ITelemetryService;
	pollIntervalMs?: number;
	claimLeaseSeconds?: number;
	globalMaxConcurrency?: number;
}

export class CronRunner {
	private readonly store: SqliteCronStore;
	private readonly materializer: CronMaterializer;
	private readonly options: CronRunnerOptions;
	private readonly claimLeaseMs: number;
	private timer: ReturnType<typeof setInterval> | undefined;
	private started = false;
	private ticking = false;
	private disposed = false;
	private stopping = false;
	private readonly activeRuns = new Map<
		string,
		{ claimToken: string; sessionId?: string; controller: AbortController }
	>();

	private readonly executions = new Set<Promise<void>>();

	constructor(options: CronRunnerOptions) {
		this.store = options.store;
		this.materializer = options.materializer;
		this.options = options;
		this.claimLeaseMs = Math.max(
			5_000,
			(options.claimLeaseSeconds ?? DEFAULT_CLAIM_LEASE_SECONDS) * 1000,
		);
	}

	public async start(): Promise<void> {
		if (this.disposed) throw new Error("CronRunner disposed");
		if (this.started) return;
		this.stopping = false;
		this.started = true;
		const interval = Math.max(
			2_000,
			this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
		);
		this.timer = setInterval(() => void this.tick(), interval);
		void this.tick();
	}

	public async stop(): Promise<void> {
		this.started = false;
		this.stopping = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		for (const active of this.activeRuns.values()) {
			active.controller.abort(
				new RunCancelledError("runner stopped before completion"),
			);
		}
		await Promise.allSettled([...this.executions]);
	}

	public async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.stop();
	}

	public async tick(): Promise<void> {
		if (this.ticking || this.stopping || this.disposed) return;
		this.ticking = true;
		let executions: Promise<void>[] = [];
		try {
			// After system sleep, polling may resume before lease heartbeats.
			// Renew locally active claims before looking for expired work so a
			// live session is not reclaimed and started a second time.
			const leaseUntilAt = new Date(
				Date.now() + this.claimLeaseMs,
			).toISOString();
			for (const [runId, active] of this.activeRuns) {
				if (!this.store.renewClaim(runId, active.claimToken, leaseUntilAt)) {
					active.controller.abort(new RunCancelledError("run lease lost"));
				}
			}
			this.materializer.materializeAll();
			const claims = this.store.claimDueRuns({
				nowIso: nowIso(),
				leaseMs: this.claimLeaseMs,
				maxConcurrency: this.options.globalMaxConcurrency ?? 10,
			});
			executions = claims.map((claim) => {
				const execution = this.executeClaim(claim).catch((error) => {
					this.options.logger?.error?.("cron.runner.execution.failed", {
						error,
					});
				});
				this.executions.add(execution);
				void execution.then(() => this.executions.delete(execution));
				return execution;
			});
		} catch (err) {
			const log = this.options.logger;
			if (log) {
				if (log.error) log.error("cron.runner.tick.failed", { error: err });
				else log.log("cron.runner.tick.failed", { error: err });
			}
		} finally {
			this.ticking = false;
		}
		// Only serialize queue dispatch. Agent turns can outlive many polls;
		// waiting for one batch must not prevent unrelated schedules dispatching.
		await Promise.allSettled(executions);
	}

	public getActiveRuns(): Array<
		CronRunRecord & { claimToken: string; sessionId?: string }
	> {
		return [...this.activeRuns.entries()].flatMap(([runId, active]) => {
			const run = this.store.getRun(runId);
			return run
				? [
						{
							...run,
							claimToken: active.claimToken,
							sessionId: active.sessionId,
						},
					]
				: [];
		});
	}

	private async executeClaim(claim: ClaimedCronRun): Promise<void> {
		const run = claim.run;
		const spec = this.store.getSpec(run.specId);
		if (!spec) {
			this.store.completeRun(run.runId, {
				status: "failed",
				error: "spec not found",
				claimToken: claim.claimToken,
			});
			return;
		}
		if (!spec.enabled || spec.removed) {
			this.store.completeRun(run.runId, {
				status: "cancelled",
				error: "spec disabled or removed",
				claimToken: claim.claimToken,
			});
			return;
		}

		if (this.stopping) {
			this.store.requeueRun({
				runId: run.runId,
				claimToken: claim.claimToken,
				releaseAttempt: true,
			});
			return;
		}

		const controller = new AbortController();
		const { signal } = controller;
		this.activeRuns.set(run.runId, {
			claimToken: claim.claimToken,
			controller,
		});
		const triggerEvent = run.triggerEventId
			? this.store.getEventLog(run.triggerEventId)
			: undefined;
		let sessionId: string | undefined;
		let sessionCleaned = false;
		let releaseLeaseHeartbeat: (() => void) | undefined;
		const startMs = Date.now();
		const runMetrics = {
			triggerKind: run.triggerKind,
			attemptCount: run.attemptCount,
			startDelayMs: Math.max(
				0,
				startMs - new Date(run.scheduledFor ?? run.createdAt).getTime(),
			),
		};
		captureScheduleRun(this.options.telemetry, {
			...runMetrics,
			phase: "started",
		});
		const deadlineAt =
			spec.timeoutSeconds && spec.timeoutSeconds > 0
				? startMs + spec.timeoutSeconds * 1000
				: undefined;
		const checkActive = () => {
			// After sleep, a promise may resume before an overdue timeout callback.
			if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
				controller.abort(new TimeoutError("cron run timed out"));
			}
			signal.throwIfAborted();
		};
		let deadline: ReturnType<typeof setTimeout> | undefined;
		if (spec.timeoutSeconds && spec.timeoutSeconds > 0) {
			deadline = setTimeout(
				() => controller.abort(new TimeoutError("cron run timed out")),
				spec.timeoutSeconds * 1000,
			);
		}

		let phase = "preparing the session request";
		try {
			releaseLeaseHeartbeat = this.startClaimLeaseHeartbeat(claim);
			const startRequest = await withCancellation(
				this.buildStartRequest(spec),
				signal,
			);
			checkActive();
			phase = "starting the agent session";
			const startup = this.options.runtimeHandlers
				.startSession(startRequest, {
					sessionMetadata: buildRunSessionMetadata(
						spec,
						run,
						this.store.getRunOrdinal(run.runId),
					),
				})
				.then(async (response) => {
					// Late responses must not touch the store or dispatch a turn after cancellation.
					if (signal.aborted)
						await this.cleanupSession(response.sessionId, true);
					else sessionId = response.sessionId.trim();
				});
			await withCancellation(startup, signal);
			checkActive();
			if (!sessionId) throw new Error("runtime returned empty sessionId");
			this.activeRuns.set(run.runId, {
				claimToken: claim.claimToken,
				controller,
				sessionId,
			});
			if (
				!this.store.attachSessionIdToRun(run.runId, sessionId, claim.claimToken)
			) {
				controller.abort(new RunCancelledError("run lease lost"));
				checkActive();
			}

			phase = "running the agent turn";
			const turnRequest: ChatRunTurnRequest = {
				config: startRequest,
				prompt: this.buildPrompt(spec, triggerEvent),
			};
			const sendPromise = this.options.runtimeHandlers.sendSession(
				sessionId,
				turnRequest,
			);
			const sendResult = await withCancellation(sendPromise, signal);
			checkActive();
			const result = sendResult.result as HubTurnResult;

			const endMs = Date.now();
			const completed = this.store.completeRun(run.runId, {
				status: "done",
				sessionId,
				claimToken: claim.claimToken,
			});
			if (!completed) {
				captureScheduleRun(this.options.telemetry, {
					...runMetrics,
					phase: "finished",
					outcome: "superseded",
					durationMs: Math.max(0, endMs - startMs),
				});
				return;
			}
			if (run.triggerKind === "one_off")
				this.store.updateSpecNextRunAt(spec.specId, undefined);
			const reportPath = this.writeReport({
				specs: this.options.specs,
				workspaceRoot: this.options.workspaceRoot,
				run: { ...run, sessionId, status: "done" },
				spec,
				data: {
					finalText: result.text,
					usage: result.usage,
					toolCalls: result.toolCalls,
					durationMs: endMs - startMs,
					triggerEvent,
				},
			});
			if (reportPath) this.store.attachReportPathToRun(run.runId, reportPath);
			captureScheduleRun(this.options.telemetry, {
				...runMetrics,
				phase: "finished",
				outcome: "success",
				durationMs: Math.max(0, endMs - startMs),
			});
			this.publishScheduleExecutionEvent(
				"schedule.execution.completed",
				spec,
				run.runId,
			);
			this.store.updateSpecLastRunAt(spec.specId, nowIso());
		} catch (err) {
			const isTimeout = err instanceof TimeoutError;
			if (sessionId && signal.aborted) {
				await this.cleanupSession(sessionId, true);
				sessionCleaned = true;
			}
			const message = err instanceof Error ? err.message : String(err);
			const endMs = Date.now();
			const errorContext = isTimeout
				? `The run exceeded its ${spec.timeoutSeconds}s timeout while ${phase} and was cancelled:`
				: err instanceof RunCancelledError
					? `The run was cancelled while ${phase}:`
					: `The run failed while ${phase}:`;
			const status = err instanceof RunCancelledError ? "cancelled" : "failed";
			const completed = this.store.completeRun(run.runId, {
				status,
				sessionId,
				error: message,
				claimToken: claim.claimToken,
			});
			if (!completed) {
				captureScheduleRun(this.options.telemetry, {
					...runMetrics,
					phase: "finished",
					outcome: "superseded",
					durationMs: Math.max(0, endMs - startMs),
				});
				return;
			}
			if (run.triggerKind === "one_off")
				this.store.updateSpecNextRunAt(spec.specId, undefined);
			const reportPath = this.writeReport({
				specs: this.options.specs,
				workspaceRoot: this.options.workspaceRoot,
				run: { ...run, sessionId, status },
				spec,
				data: {
					error: message,
					errorContext,
					durationMs: endMs - startMs,
					triggerEvent,
				},
			});
			if (reportPath) this.store.attachReportPathToRun(run.runId, reportPath);
			captureScheduleRun(this.options.telemetry, {
				...runMetrics,
				phase: "finished",
				outcome:
					status === "cancelled"
						? "cancelled"
						: isTimeout
							? "timeout"
							: "failed",
				durationMs: Math.max(0, endMs - startMs),
			});
			this.publishScheduleExecutionEvent(
				"schedule.execution.failed",
				spec,
				run.runId,
			);
		} finally {
			if (deadline) clearTimeout(deadline);
			releaseLeaseHeartbeat?.();
			if (sessionId && !sessionCleaned)
				await this.cleanupSession(sessionId, signal.aborted);

			this.activeRuns.delete(run.runId);
		}
	}

	private writeReport(
		input: Parameters<typeof writeCronRunReport>[0],
	): string | undefined {
		try {
			return writeCronRunReport(input);
		} catch (error) {
			this.options.logger?.error?.("cron.runner.report.failed", {
				runId: input.run.runId,
				error,
			});
			return undefined;
		}
	}

	private async cleanupSession(
		sessionId: string,
		abort: boolean,
	): Promise<void> {
		for (const action of abort
			? (["abortSession", "stopSession"] as const)
			: (["stopSession"] as const)) {
			try {
				await withTimeout(
					this.options.runtimeHandlers[action](sessionId),
					CLEANUP_TIMEOUT_MS,
				);
			} catch (error) {
				this.options.logger?.error?.("cron.runner.cleanup.failed", {
					sessionId,
					action,
					error,
				});
			}
		}
	}

	private publishScheduleExecutionEvent(
		eventType: "schedule.execution.completed" | "schedule.execution.failed",
		spec: CronSpecRecord,
		runId: string,
	): void {
		if (spec.source !== "hub-schedule" || !this.options.eventPublisher) {
			return;
		}
		const run = this.store.getRun(runId);
		if (!run) {
			return;
		}
		const status =
			run.status === "done"
				? "success"
				: run.status === "cancelled"
					? "aborted"
					: run.status === "running"
						? "running"
						: run.status === "queued"
							? "pending"
							: "failed";
		this.options.eventPublisher(eventType, {
			scheduleId: spec.externalId,
			executionId: run.runId,
			sessionId: run.sessionId,
			triggeredAt: new Date(run.scheduledFor ?? run.createdAt).getTime(),
			startedAt: run.startedAt ? new Date(run.startedAt).getTime() : undefined,
			endedAt: run.completedAt
				? new Date(run.completedAt).getTime()
				: undefined,
			status,
			errorMessage: run.error,
		});
	}

	private buildPrompt(
		spec: CronSpecRecord,
		triggerEvent: CronEventLogRecord | undefined,
	): string {
		const prompt = spec.prompt ?? "";
		if (!triggerEvent) return prompt;
		const eventContext = {
			eventId: triggerEvent.eventId,
			eventType: triggerEvent.eventType,
			source: triggerEvent.source,
			subject: triggerEvent.subject,
			occurredAt: triggerEvent.occurredAt,
			workspaceRoot: triggerEvent.workspaceRoot,
			dedupeKey: triggerEvent.dedupeKey,
			attributes: triggerEvent.attributes,
			payload: triggerEvent.payload,
		};
		return `${prompt}\n\nTrigger event:\n${JSON.stringify(eventContext, null, 2)}`;
	}

	private startClaimLeaseHeartbeat(claim: ClaimedCronRun): () => void {
		const heartbeatMs = Math.max(1_000, Math.floor(this.claimLeaseMs / 2));
		const interval = setInterval(() => {
			const leaseUntilAt = new Date(
				Date.now() + this.claimLeaseMs,
			).toISOString();
			const renewed = this.store.renewClaim(
				claim.run.runId,
				claim.claimToken,
				leaseUntilAt,
			);
			if (!renewed) {
				clearInterval(interval);
				this.activeRuns
					.get(claim.run.runId)
					?.controller.abort(new RunCancelledError("run lease lost"));
			}
		}, heartbeatMs);
		return () => clearInterval(interval);
	}

	private async buildSystemPrompt(
		spec: CronSpecRecord,
		workspaceRoot: string,
		mode: "act" | "plan" | "yolo",
		provider: string,
	): Promise<string> {
		const notes = buildNotesSystemPromptSection(spec.notesDirectory);
		const additional = mergeRulesForSystemPrompt(undefined, notes);
		const metadata = await buildWorkspaceMetadata(workspaceRoot);
		const base = buildClineSystemPrompt({
			ide: "Cline Cron",
			workspaceRoot,
			workspaceName: basename(workspaceRoot),
			metadata,
			rules: spec.systemPrompt ? undefined : additional,
			mode,
			providerId: provider,
			overridePrompt: spec.systemPrompt,
			platform:
				(typeof process !== "undefined" && process?.platform) || "unknown",
		});
		return spec.systemPrompt
			? (mergeRulesForSystemPrompt(base, additional) ?? base)
			: base;
	}

	private async buildStartRequest(
		spec: CronSpecRecord,
	): Promise<ChatStartSessionRequest> {
		const workspaceRoot = (spec.workspaceRoot ?? "").trim();
		const provider = (spec.providerId ?? "").trim();
		const model = (spec.modelId ?? "").trim();
		const runtimeOptions =
			spec.metadata?.__hubRuntimeOptions &&
			typeof spec.metadata.__hubRuntimeOptions === "object" &&
			!Array.isArray(spec.metadata.__hubRuntimeOptions)
				? (spec.metadata.__hubRuntimeOptions as {
						enableTools?: boolean;
						enableSpawn?: boolean;
						enableTeams?: boolean;
						autoApproveTools?: boolean;
					})
				: undefined;
		const cwd =
			typeof spec.metadata?.__hubScheduleCwd === "string" &&
			spec.metadata.__hubScheduleCwd.trim()
				? spec.metadata.__hubScheduleCwd.trim()
				: workspaceRoot;
		if (!workspaceRoot) {
			throw new Error("cron spec requires workspaceRoot");
		}
		const mode =
			spec.mode === "plan" ? "plan" : spec.mode === "act" ? "act" : "yolo";
		return {
			workspaceRoot,
			cwd,
			provider,
			model,
			mode,
			source: spec.source?.trim() || "user",
			systemPrompt: await this.buildSystemPrompt(
				spec,
				workspaceRoot,
				mode,
				provider,
			),
			maxIterations: spec.maxIterations,
			enableTools: runtimeOptions?.enableTools ?? true,
			enableSpawn: runtimeOptions?.enableSpawn ?? true,
			enableTeams: runtimeOptions?.enableTeams ?? true,
			autoApproveTools: runtimeOptions?.autoApproveTools ?? true,
			toolPolicies: buildToolPolicies(spec, mode),
			configExtensions: DEFAULT_CRON_EXTENSIONS.filter((extension) =>
				cronExtensionEnabled(spec, extension),
			),
		};
	}
}
