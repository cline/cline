import { basename } from "node:path";
import type {
	BasicLogger,
	ChatRunTurnRequest,
	ChatStartSessionRequest,
} from "@clinebot/shared";
import { buildClineSystemPrompt } from "@clinebot/shared";
import { nowIso } from "@clinebot/shared/db";
import type { ResolveCronSpecsDirOptions } from "@clinebot/shared/storage";
import { createUserInstructionConfigWatcher } from "../extensions/config";
import { DefaultToolNames } from "../extensions/tools/constants";
import {
	loadRulesForSystemPromptFromWatcher,
	mergeRulesForSystemPrompt,
} from "../runtime/rules";
import { buildWorkspaceMetadata } from "../services/workspace-manifest";
import type { CronMaterializer } from "./cron-materializer";
import { writeCronRunReport } from "./cron-report-writer";
import { ResourceLimiter } from "./resource-limiter";
import type { HubScheduleRuntimeHandlers } from "./schedule-service";
import type {
	ClaimedCronRun,
	CronEventLogRecord,
	CronSpecRecord,
	SqliteCronStore,
} from "./sqlite-cron-store";

/**
 * Trigger-agnostic runner for queued cron runs.
 *
 * Polls cron.db every N seconds, atomically claims queued runs, executes
 * them through the existing runtime handlers (same surface used by the
 * legacy `HubScheduleService`), persists status transitions transactionally,
 * and writes a markdown report per completion/failure.
 */

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
): ChatStartSessionRequest["toolPolicies"] | undefined {
	if (spec.tools === undefined) {
		return { "*": { autoApprove: true } };
	}
	const policies: NonNullable<ChatStartSessionRequest["toolPolicies"]> = {
		"*": { enabled: false, autoApprove: true },
	};
	for (const tool of spec.tools) {
		policies[tool] = { enabled: true, autoApprove: true };
	}
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

export interface CronRunnerOptions {
	store: SqliteCronStore;
	materializer: CronMaterializer;
	runtimeHandlers: HubScheduleRuntimeHandlers;
	/** Default runtime workspace for the hub/daemon process. */
	workspaceRoot: string;
	/** Cron spec source/report location. Defaults to global `~/.cline/cron`. */
	specs?: ResolveCronSpecsDirOptions;
	logger?: BasicLogger;
	pollIntervalMs?: number;
	claimLeaseSeconds?: number;
	globalMaxConcurrency?: number;
}

export class CronRunner {
	private readonly store: SqliteCronStore;
	private readonly materializer: CronMaterializer;
	private readonly options: CronRunnerOptions;
	private readonly limiter: ResourceLimiter;
	private readonly claimLeaseMs: number;
	private timer: ReturnType<typeof setInterval> | undefined;
	private started = false;
	private ticking = false;
	private disposed = false;
	private stopping = false;
	private readonly activeRuns = new Map<
		string,
		{ claimToken: string; sessionId?: string }
	>();

	constructor(options: CronRunnerOptions) {
		this.store = options.store;
		this.materializer = options.materializer;
		this.options = options;
		this.limiter = new ResourceLimiter(options.globalMaxConcurrency ?? 10);
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
		await this.tick();
		this.timer = setInterval(() => void this.tick(), interval);
	}

	public async stop(): Promise<void> {
		const wasStarted = this.started;
		this.started = false;
		this.stopping = true;
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		if (!wasStarted) return;
		const active = [...this.activeRuns.entries()];
		await Promise.all(
			active.map(async ([runId, run]) => {
				if (run.sessionId) {
					try {
						await this.options.runtimeHandlers.abortSession(run.sessionId);
					} catch {
						// best effort
					}
				}
				try {
					this.store.requeueRun({
						runId,
						claimToken: run.claimToken,
						error: "runner stopped before completion",
					});
				} catch {
					// best effort
				}
			}),
		);
	}

	public async dispose(): Promise<void> {
		if (this.disposed) return;
		this.disposed = true;
		await this.stop();
	}

	public async tick(): Promise<void> {
		if (this.ticking) return;
		this.ticking = true;
		try {
			this.materializer.materializeAll();
			const claims = this.store.claimDueRuns({
				nowIso: nowIso(),
				leaseMs: this.claimLeaseMs,
			});
			await Promise.allSettled(claims.map((claim) => this.executeClaim(claim)));
		} catch (err) {
			const log = this.options.logger;
			if (log) {
				if (log.error) log.error("cron.runner.tick.failed", { error: err });
				else log.log("cron.runner.tick.failed", { error: err });
			}
		} finally {
			this.ticking = false;
		}
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

		const maxParallel =
			spec.maxParallel && spec.maxParallel > 0 ? spec.maxParallel : 1;
		const acquired = this.limiter.acquire(spec.specId, run.runId, maxParallel);
		if (!acquired) {
			this.store.requeueRun({
				runId: run.runId,
				claimToken: claim.claimToken,
				error: "concurrency limit reached",
			});
			return;
		}
		if (this.stopping) {
			this.limiter.release(spec.specId, run.runId);
			this.store.requeueRun({
				runId: run.runId,
				claimToken: claim.claimToken,
				error: "runner stopped before execution",
			});
			return;
		}

		this.activeRuns.set(run.runId, { claimToken: claim.claimToken });
		const triggerEvent = run.triggerEventId
			? this.store.getEventLog(run.triggerEventId)
			: undefined;
		let sessionId: string | undefined;
		let releaseLeaseHeartbeat: (() => void) | undefined;
		const startMs = Date.now();
		let executionDeadlineMs: number | undefined;
		if (spec.timeoutSeconds && spec.timeoutSeconds > 0) {
			executionDeadlineMs = startMs + spec.timeoutSeconds * 1000;
		}

		try {
			releaseLeaseHeartbeat = this.startClaimLeaseHeartbeat(claim);
			const startRequest = await this.buildStartRequest(spec);
			const startResp =
				await this.options.runtimeHandlers.startSession(startRequest);
			sessionId = startResp.sessionId.trim();
			if (!sessionId) throw new Error("runtime returned empty sessionId");
			this.activeRuns.set(run.runId, {
				claimToken: claim.claimToken,
				sessionId,
			});
			this.store.attachSessionIdToRun(run.runId, sessionId);

			const turnRequest: ChatRunTurnRequest = {
				config: startRequest,
				prompt: this.buildPrompt(spec, triggerEvent),
			};
			const sendPromise = this.options.runtimeHandlers.sendSession(
				sessionId,
				turnRequest,
			);
			const timeoutMs = executionDeadlineMs
				? Math.max(1, executionDeadlineMs - Date.now())
				: 0;
			const sendResult = await withTimeout(sendPromise, timeoutMs);
			const result = sendResult.result as HubTurnResult;

			const endMs = Date.now();
			const reportPath = writeCronRunReport({
				specs: this.options.specs,
				workspaceRoot: this.options.workspaceRoot,
				run: { ...run, sessionId, status: "done" },
				spec,
				data: {
					finalText: result.text,
					usage: result.usage,
					toolCalls: result.toolCalls,
					durationMs: endMs - startMs,
				},
			});
			this.store.completeRun(run.runId, {
				status: "done",
				sessionId,
				reportPath,
				claimToken: claim.claimToken,
			});
			this.store.updateSpecLastRunAt(spec.specId, nowIso());
		} catch (err) {
			const isTimeout = err instanceof TimeoutError;
			if (sessionId && isTimeout) {
				try {
					await this.options.runtimeHandlers.abortSession(sessionId);
				} catch {
					// best effort
				}
			}
			const message = err instanceof Error ? err.message : String(err);
			const endMs = Date.now();
			const reportPath = writeCronRunReport({
				specs: this.options.specs,
				workspaceRoot: this.options.workspaceRoot,
				run: { ...run, sessionId, status: "failed" },
				spec,
				data: { error: message, durationMs: endMs - startMs },
			});
			this.store.completeRun(run.runId, {
				status: "failed",
				sessionId,
				reportPath,
				error: message,
				claimToken: claim.claimToken,
			});
		} finally {
			releaseLeaseHeartbeat?.();
			if (sessionId) {
				try {
					await this.options.runtimeHandlers.stopSession(sessionId);
				} catch {
					// best effort
				}
			}
			this.activeRuns.delete(run.runId);
			this.limiter.release(spec.specId, run.runId);
		}
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
			}
		}, heartbeatMs);
		return () => clearInterval(interval);
	}

	private async loadRulesForSpec(
		spec: CronSpecRecord,
	): Promise<string | undefined> {
		if (!cronExtensionEnabled(spec, "rules")) return undefined;
		const workspaceRoot = spec.workspaceRoot?.trim();
		if (!workspaceRoot) return undefined;
		const watcher = createUserInstructionConfigWatcher({
			skills: { directories: [] },
			rules: { workspacePath: workspaceRoot },
			workflows: { workspacePath: workspaceRoot },
		});
		try {
			await watcher.start();
			return loadRulesForSystemPromptFromWatcher(watcher);
		} finally {
			watcher.stop();
		}
	}

	private async buildSystemPrompt(
		spec: CronSpecRecord,
		workspaceRoot: string,
		mode: "act" | "plan" | "yolo",
		provider: string,
	): Promise<string> {
		const rules = await this.loadRulesForSpec(spec);
		const notes = buildNotesSystemPromptSection(spec.notesDirectory);
		const additional = mergeRulesForSystemPrompt(rules, notes);
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
		if (!workspaceRoot) {
			throw new Error("cron spec requires workspaceRoot");
		}
		const mode =
			spec.mode === "plan" ? "plan" : spec.mode === "act" ? "act" : "yolo";
		return {
			workspaceRoot,
			cwd: workspaceRoot,
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
			enableTools: true,
			enableSpawn: true,
			enableTeams: true,
			autoApproveTools: true,
			toolPolicies: buildToolPolicies(spec, mode),
			configExtensions: DEFAULT_CRON_EXTENSIONS.filter((extension) =>
				cronExtensionEnabled(spec, extension),
			),
		};
	}
}
