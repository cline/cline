/**
 * `Engine` — owns exactly one execution (Gateway RFC, Phase 1).
 *
 * The engine composes one validated run around the existing `@cline/agents`
 * loop (which drives `@cline/llms` handlers). It binds caller-supplied
 * tools, hooks, approval port, artifact sink, clock, and telemetry; emits a
 * canonical ordered `EngineEvent` stream; supports cooperative steer,
 * interrupt, and hard abort; and returns a `RunResult` plus persistence
 * deltas.
 *
 * Deliberately absent: databases, config watchers, filesystem discovery,
 * listeners, daemons, global singletons, connectors, process supervisors.
 * All state is per-instance; concurrent engines share no mutable module
 * state.
 */

import type { AgentRuntimeConfig } from "@cline/agents";
import { AgentRuntime } from "@cline/agents";
import type {
	AgentMessage,
	AgentRunResult,
	AgentRuntimeEvent,
	AgentRuntimeHooks,
	AgentStopControl,
	AgentUsage,
	ToolApprovalResult,
} from "@cline/shared";
import type {
	EngineEvent,
	EngineEventListener,
	EngineEventPayload,
} from "./events";
import type {
	EngineErrorInfo,
	EnginePersistenceDelta,
	EngineRunResult,
	EngineRunStatus,
} from "./result";
import {
	type EngineArtifact,
	type EngineClock,
	type EngineOptions,
	type RunSpec,
	SYSTEM_CLOCK,
} from "./run-spec";

/** Thrown when an engine is asked to violate its single-execution contract. */
export class EngineStateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "EngineStateError";
	}
}

export type EngineStatus = "created" | "running" | EngineRunStatus;

export class Engine {
	private readonly spec: RunSpec;
	private readonly clock: EngineClock;
	private readonly options: EngineOptions;
	private readonly listeners = new Set<EngineEventListener>();
	private readonly eventLog: EngineEvent[] = [];
	private sequence = 0;

	private executionStarted = false;
	private runtime?: AgentRuntime;
	private finalResult?: EngineRunResult;

	private readonly steerQueue: string[] = [];
	private interruptRequested = false;
	private interruptReason?: string;
	private abortRequested = false;
	private abortReason?: string;

	// Per-model-call usage metering (usage-updated carries cumulative
	// totals; model-call-completed events carry the per-call delta).
	private meteredUsage: AgentUsage = {
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
	};
	private modelCallStartedAt?: number;
	private modelCallInFlight = false;

	private readonly persistenceDeltas: EnginePersistenceDelta[] = [];

	constructor(spec: RunSpec, options: EngineOptions = {}) {
		this.spec = spec;
		this.options = options;
		this.clock = options.clock ?? SYSTEM_CLOCK;
	}

	get runId(): string {
		return this.spec.runId;
	}

	get status(): EngineStatus {
		if (this.finalResult) {
			return this.finalResult.status;
		}
		return this.executionStarted ? "running" : "created";
	}

	/** Events emitted so far, in sequence order. */
	get events(): readonly EngineEvent[] {
		return [...this.eventLog];
	}

	get result(): EngineRunResult | undefined {
		return this.finalResult;
	}

	subscribe(
		listener: EngineEventListener,
		options: { replay?: boolean } = {},
	): () => void {
		if (options.replay) {
			for (const event of this.eventLog) {
				listener(event);
			}
		}
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Queue steering text that merges into the active run before its next
	 * model request. Returns false once the run is terminal.
	 */
	steer(text: string): boolean {
		if (this.finalResult) {
			return false;
		}
		this.steerQueue.push(text);
		this.emit({ type: "steer-queued", text });
		return true;
	}

	/**
	 * Request a cooperative interruption: the run stops at the next control
	 * point (before a model call or after a tool) instead of mid-flight.
	 */
	interrupt(reason?: string): void {
		if (this.finalResult || this.interruptRequested) {
			return;
		}
		this.interruptRequested = true;
		this.interruptReason = reason;
		this.emit({ type: "interrupt-requested", reason });
	}

	/** Hard-stop the run immediately. */
	abort(reason?: string): void {
		if (this.finalResult || this.abortRequested) {
			return;
		}
		this.abortRequested = true;
		this.abortReason = reason;
		this.emit({ type: "abort-requested", reason });
		this.runtime?.abort(reason ?? "Run aborted");
	}

	/** Execute the run. An engine owns exactly one execution. */
	async run(): Promise<EngineRunResult> {
		if (this.executionStarted) {
			throw new EngineStateError(
				"Engine owns exactly one execution; create a new engine for a new run",
			);
		}
		this.executionStarted = true;
		const startedAt = this.clock.now();

		const runtime = new AgentRuntime(this.buildRuntimeConfig());
		this.runtime = runtime;
		const unsubscribe = runtime.subscribe((event) =>
			this.translateRuntimeEvent(event),
		);

		let agentResult: AgentRunResult;
		try {
			agentResult = await runtime.run(
				this.spec.input as string | readonly AgentMessage[],
			);
		} finally {
			unsubscribe();
			this.runtime = undefined;
		}

		const endedAt = this.clock.now();
		const status = this.mapStatus(agentResult);
		const error: EngineErrorInfo | undefined =
			status === "failed" && agentResult.error
				? { name: agentResult.error.name, message: agentResult.error.message }
				: undefined;

		this.persistenceDeltas.push(
			{ kind: "usage-updated", usage: agentResult.usage },
			{ kind: "run-status-changed", status },
		);

		const result: EngineRunResult = {
			runId: this.spec.runId,
			status,
			outputText: agentResult.outputText,
			messages: agentResult.messages,
			usage: agentResult.usage,
			iterations: agentResult.iterations,
			startedAt,
			endedAt,
			error,
			persistence: [...this.persistenceDeltas],
		};
		this.finalResult = result;

		if (status === "failed" && error) {
			this.emitAbandonedModelCall();
			this.emit({ type: "run-failed", error, result });
		} else {
			this.emit({ type: "run-finished", result });
		}
		return result;
	}

	// ---------------------------------------------------------------------
	// Internals
	// ---------------------------------------------------------------------

	private buildRuntimeConfig(): AgentRuntimeConfig {
		const spec = this.spec;
		const base = {
			sessionId: spec.sessionId,
			agentId: spec.botId,
			conversationId: spec.sessionId,
			systemPrompt: spec.systemPrompt,
			tools: spec.tools,
			hooks: spec.hooks,
			plugins: [
				{
					name: "engine-controls",
					setup: () => ({ hooks: this.controlHooks() }),
				},
			],
			initialMessages: spec.initialMessages,
			maxIterations: spec.maxIterations,
			toolPolicies: spec.toolPolicies,
			toolContextMetadata: this.buildToolContextMetadata(),
			requestToolApproval: this.buildApprovalPort(),
			consumePendingUserMessage: () => this.consumeSteerText(),
			logger: this.options.logger,
			telemetry: this.options.telemetry,
		};
		if (spec.model.kind === "model") {
			return {
				...base,
				model: spec.model.model,
				messageModelInfo: spec.model.modelInfo,
			};
		}
		return {
			...base,
			providerId: spec.model.providerId,
			modelId: spec.model.modelId,
			apiKey: spec.model.apiKey,
			baseUrl: spec.model.baseUrl,
			headers: spec.model.headers,
			timeoutMs: spec.model.timeoutMs,
			options: spec.model.options,
		};
	}

	/** Cooperative stop checkpoints for interrupt/abort. */
	private controlHooks(): Partial<AgentRuntimeHooks> {
		const check = (): AgentStopControl | undefined => this.stopControl();
		return {
			beforeRun: check,
			beforeModel: () => {
				// Checkpoint for per-call duration metering.
				this.modelCallStartedAt = this.clock.now();
				this.modelCallInFlight = true;
				return check();
			},
			afterTool: check,
		};
	}

	private stopControl(): AgentStopControl | undefined {
		if (this.abortRequested) {
			return { stop: true, reason: this.abortReason ?? "Run aborted" };
		}
		if (this.interruptRequested) {
			return { stop: true, reason: this.interruptReason ?? "Run interrupted" };
		}
		return undefined;
	}

	private consumeSteerText(): string | undefined {
		if (this.steerQueue.length === 0) {
			return undefined;
		}
		const text = this.steerQueue.splice(0).join("\n\n");
		this.emit({ type: "steer-merged", text });
		return text;
	}

	private buildToolContextMetadata(): Record<string, unknown> {
		const sink = this.options.artifacts;
		if (!sink) {
			return { ...this.spec.metadata };
		}
		return {
			...this.spec.metadata,
			artifacts: {
				put: async (artifact: EngineArtifact) => {
					await sink.put(artifact);
					this.emit({
						type: "artifact-created",
						name: artifact.name,
						mediaType: artifact.mediaType,
					});
				},
			},
		};
	}

	private buildApprovalPort(): AgentRuntimeConfig["requestToolApproval"] {
		const port = this.spec.requestApproval;
		if (!port) {
			return undefined;
		}
		return async (request) => {
			this.emit({
				type: "approval-requested",
				toolCallId: request.toolCallId,
				toolName: request.toolName,
				input: request.input,
			});
			let result: ToolApprovalResult;
			try {
				result = await port(request);
			} catch (error) {
				result = {
					approved: false,
					reason: `Approval request failed: ${
						error instanceof Error ? error.message : String(error)
					}`,
				};
			}
			this.emit({
				type: "approval-resolved",
				toolCallId: request.toolCallId,
				toolName: request.toolName,
				approved: result.approved,
				reason: result.reason,
			});
			return result;
		};
	}

	private mapStatus(agentResult: AgentRunResult): EngineRunStatus {
		switch (agentResult.status) {
			case "completed":
				return "completed";
			case "failed":
				return "failed";
			case "aborted":
				return this.interruptRequested && !this.abortRequested
					? "interrupted"
					: "aborted";
		}
	}

	private translateRuntimeEvent(event: AgentRuntimeEvent): void {
		switch (event.type) {
			case "run-started":
				this.emit({ type: "run-started" });
				break;
			case "turn-started":
				this.emit({ type: "turn-started", iteration: event.iteration });
				break;
			case "message-added": {
				const index = event.snapshot.messages.length - 1;
				this.persistenceDeltas.push({
					kind: "message-appended",
					index,
					message: event.message,
				});
				this.emit({
					type: "message-appended",
					message: event.message,
					index,
				});
				break;
			}
			case "assistant-text-delta":
				this.emit({ type: "text-delta", text: event.text });
				break;
			case "assistant-reasoning-delta":
				this.emit({
					type: "reasoning-delta",
					text: event.text,
					redacted: event.redacted,
				});
				break;
			case "assistant-media":
				this.emit({ type: "media", media: event.media });
				break;
			case "tool-started":
				this.emit({
					type: "tool-started",
					toolCallId: event.toolCall.toolCallId,
					toolName: event.toolCall.toolName,
					input: event.toolCall.input,
				});
				break;
			case "tool-updated":
				this.emit({
					type: "tool-updated",
					toolCallId: event.toolCall.toolCallId,
					toolName: event.toolCall.toolName,
					update: event.update,
				});
				break;
			case "tool-finished": {
				const resultPart = event.message.content.find(
					(part) =>
						part.type === "tool-result" &&
						part.toolCallId === event.toolCall.toolCallId,
				);
				this.emit({
					type: "tool-finished",
					toolCallId: event.toolCall.toolCallId,
					toolName: event.toolCall.toolName,
					output:
						resultPart?.type === "tool-result" ? resultPart.output : undefined,
					isError:
						resultPart?.type === "tool-result" ? resultPart.isError : undefined,
				});
				break;
			}
			case "usage-updated":
				this.emit({ type: "usage-updated", usage: event.usage });
				this.emitModelCallCompleted(event.usage);
				break;
			case "turn-finished":
				this.emit({
					type: "turn-finished",
					iteration: event.iteration,
					toolCallCount: event.toolCallCount,
				});
				break;
			case "status-notice":
				this.emit({
					type: "status",
					message: event.message,
					metadata: event.metadata,
				});
				break;
			// Terminal events are emitted by the engine itself with the final
			// EngineRunResult; the runtime's assistant-message duplicates
			// message-added and is dropped.
			case "assistant-message":
			case "run-finished":
			case "run-failed":
				break;
		}
	}

	private modelIdentity(): { providerId?: string; modelId?: string } {
		if (this.spec.model.kind === "provider") {
			return {
				providerId: this.spec.model.providerId,
				modelId: this.spec.model.modelId,
			};
		}
		return {
			providerId: this.spec.model.modelInfo?.provider,
			modelId: this.spec.model.modelInfo?.id,
		};
	}

	/** Emit the per-call usage delta for a completed model call. */
	private emitModelCallCompleted(cumulative: AgentUsage): void {
		const previous = this.meteredUsage;
		const delta = {
			inputTokens: Math.max(0, cumulative.inputTokens - previous.inputTokens),
			outputTokens: Math.max(
				0,
				cumulative.outputTokens - previous.outputTokens,
			),
			cacheReadTokens: Math.max(
				0,
				cumulative.cacheReadTokens - previous.cacheReadTokens,
			),
			cacheWriteTokens: Math.max(
				0,
				cumulative.cacheWriteTokens - previous.cacheWriteTokens,
			),
			providerCost:
				cumulative.totalCost !== undefined
					? Math.max(0, cumulative.totalCost - (previous.totalCost ?? 0))
					: undefined,
		};
		this.meteredUsage = { ...cumulative };
		const now = this.clock.now();
		const durationMs =
			this.modelCallStartedAt !== undefined
				? Math.max(0, now - this.modelCallStartedAt)
				: undefined;
		this.modelCallInFlight = false;
		this.emit({
			type: "model-call-completed",
			...this.modelIdentity(),
			inputTokens: delta.inputTokens,
			outputTokens: delta.outputTokens,
			totalTokens: delta.inputTokens + delta.outputTokens,
			cacheReadTokens: delta.cacheReadTokens,
			cacheWriteTokens: delta.cacheWriteTokens,
			providerCost: delta.providerCost,
			durationMs,
			status: "ok",
		});
	}

	/** A run failed while a model call was in flight and unreported. */
	private emitAbandonedModelCall(): void {
		if (!this.modelCallInFlight) {
			return;
		}
		this.modelCallInFlight = false;
		const now = this.clock.now();
		this.emit({
			type: "model-call-completed",
			...this.modelIdentity(),
			inputTokens: 0,
			outputTokens: 0,
			totalTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			durationMs:
				this.modelCallStartedAt !== undefined
					? Math.max(0, now - this.modelCallStartedAt)
					: undefined,
			status: "error",
		});
	}

	private emit(payload: EngineEventPayload): void {
		const event: EngineEvent = {
			...payload,
			sequence: this.sequence,
			runId: this.spec.runId,
			timestamp: this.clock.now(),
		};
		this.sequence += 1;
		this.eventLog.push(event);
		for (const listener of this.listeners) {
			listener(event);
		}
	}
}

export function createEngine(spec: RunSpec, options?: EngineOptions): Engine {
	return new Engine(spec, options);
}
