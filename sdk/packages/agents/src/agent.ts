/**
 * Agent Class
 *
 * The main class for building and running agentic loops with LLMs.
 */

import type { LlmsProviders } from "@clinebot/llms";
import { nanoid } from "nanoid";
import { buildInitialUserContent } from "./agent-input.js";
import {
	createApiTimeoutSignal,
	createHandlerFromConfig,
	mergeAbortSignals,
	observeAbortSignal,
	serializeAbortReason,
} from "./config-helpers.js";
import {
	buildFailedToolCallFeedback,
	buildInvalidToolCallFeedback,
	buildInvalidToolResultMessage,
	isNonRecoverableApiError,
	type MistakeTrackingDeps,
	recordMistake,
} from "./error-handling.js";
import {
	type ContributionRegistry,
	createContributionRegistry,
} from "./extensions.js";
import { HookEngine, registerLifecycleHandlers } from "./hooks/index.js";
import { MessageBuilder } from "./message-builder.js";
import { createAgentRuntimeBus } from "./runtime/agent-runtime-bus.js";
import { ConversationStore } from "./runtime/conversation-store.js";
import { LifecycleOrchestrator } from "./runtime/lifecycle-orchestrator.js";
import { ToolOrchestrator } from "./runtime/tool-orchestrator.js";
import { TurnProcessor } from "./runtime/turn-processor.js";
import { createToolRegistry, validateTools } from "./tools/index.js";
import type {
	AgentConfig,
	AgentEvent,
	AgentExtensionRegistry,
	AgentFinishReason,
	AgentResult,
	AgentUsage,
	BasicLogger,
	PendingToolCall,
	Tool,
	ToolApprovalResult,
	ToolCallRecord,
	ToolContext,
	ToolPolicy,
} from "./types.js";

const DEFAULT_REMINDER_TEXT =
	"REMINDER: If you have gathered enough information to answer the user's question, please provide your final answer now without using any more tools.";

export class Agent {
	private config: Required<
		Pick<
			AgentConfig,
			| "providerId"
			| "modelId"
			| "systemPrompt"
			| "tools"
			| "maxParallelToolCalls"
			| "apiTimeoutMs"
			| "maxConsecutiveMistakes"
			| "reminderAfterIterations"
			| "reminderText"
			| "hookErrorMode"
		>
	> &
		AgentConfig;
	private handler: LlmsProviders.ApiHandler;
	private toolRegistry: Map<string, Tool>;
	private abortController: AbortController | null = null;
	private contributionRegistry: ContributionRegistry;
	private readonly hookEngine: HookEngine;
	private messageBuilder: MessageBuilder;
	private readonly logger?: BasicLogger;
	private extensionsInitialized = false;
	private activeRunId = "";
	private runState: "idle" | "running" | "shutting_down" = "idle";
	private readonly runtimeBus = createAgentRuntimeBus();
	private readonly conversationStore: ConversationStore;
	private readonly lifecycle: LifecycleOrchestrator;
	private turnProcessor: TurnProcessor;
	private readonly toolOrchestrator: ToolOrchestrator;
	private readonly agentId: string;
	private readonly parentAgentId: string | null;

	constructor(config: AgentConfig) {
		this.config = {
			...config,
			maxIterations: config.maxIterations,
			maxParallelToolCalls: config.maxParallelToolCalls ?? 8,
			apiTimeoutMs: config.apiTimeoutMs ?? 120000,
			maxConsecutiveMistakes: config.maxConsecutiveMistakes ?? 6,
			maxTokensPerTurn: config.maxTokensPerTurn,
			reminderAfterIterations: config.reminderAfterIterations ?? 0,
			reminderText: config.reminderText ?? DEFAULT_REMINDER_TEXT,
			hookErrorMode: config.hookErrorMode ?? "ignore",
			extensions: config.extensions ?? [],
			toolPolicies: config.toolPolicies ?? {},
		};

		this.agentId = `agent_${Date.now()}_${nanoid(6)}`;
		this.parentAgentId = config.parentAgentId ?? null;
		this.conversationStore = new ConversationStore(
			config.initialMessages ?? [],
		);
		this.logger = config.logger;

		this.contributionRegistry = createContributionRegistry({
			extensions: this.config.extensions,
		});
		this.contributionRegistry.resolve();
		this.contributionRegistry.validate();

		const defaultFailureMode =
			this.config.hookErrorMode === "throw" ? "fail_closed" : "fail_open";
		this.hookEngine = new HookEngine({
			policies: {
				defaultPolicy: {
					failureMode: defaultFailureMode,
				},
				...this.config.hookPolicies,
			},
			onDispatchError: (error) => {
				this.reportRecoverableError(error);
			},
		});

		registerLifecycleHandlers(this.hookEngine, {
			...this.config,
			extensions: this.contributionRegistry.getValidatedExtensions(),
		});

		this.messageBuilder = new MessageBuilder();
		this.toolRegistry = createToolRegistry([]);
		this.handler = createHandlerFromConfig(this.config, this.logger);
		this.turnProcessor = new TurnProcessor({
			handler: this.handler,
			messageBuilder: this.messageBuilder,
			emit: (event) => this.emit(event),
		});
		this.lifecycle = new LifecycleOrchestrator({
			hookEngine: this.hookEngine,
			runtimeBus: this.runtimeBus,
			getRunId: () =>
				this.activeRunId || this.conversationStore.getConversationId(),
			getAgentId: () => this.agentId,
			getConversationId: () => this.conversationStore.getConversationId(),
			getParentAgentId: () => this.parentAgentId,
			onHookContext: (source, context) =>
				this.appendHookContext(source, context),
			onDispatchError: (error) => this.reportRecoverableError(error),
		});
		this.toolOrchestrator = new ToolOrchestrator({
			getAgentId: () => this.agentId,
			getConversationId: () => this.conversationStore.getConversationId(),
			getParentAgentId: () => this.parentAgentId,
			emit: (event) => this.emit(event),
			dispatchLifecycle: ({ source, iteration, stage, payload }) =>
				this.lifecycle.dispatch(source, {
					stage,
					iteration,
					payload,
				}),
			authorizeToolCall: (call, context) =>
				this.authorizeToolCall(call, context),
			onCancelRequested: () => {
				this.abort(new Error("Tool call requested cancellation"));
			},
			onLog: (level, message, metadata) => {
				this.log(level, message, metadata);
			},
		});

		// onEvent callback and runtime hooks are both runtime-bus subscribers.
		this.runtimeBus.subscribeRuntimeEvent((event) => {
			try {
				this.config.onEvent?.(event);
			} catch {
				// Ignore callback errors
			}
		});
		this.runtimeBus.subscribeRuntimeEvent((event) => {
			this.lifecycle.dispatchRuntimeEvent(event);
		});
	}

	async run(
		userMessage: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<AgentResult> {
		this.assertCanStartRun();
		this.log("info", "Agent run requested", {
			agentId: this.agentId,
			conversationId: this.conversationStore.getConversationId(),
			messageLength: userMessage.length,
		});
		await this.ensureExtensionsInitialized();

		this.conversationStore.resetForRun();

		const preparedInput = await this.prepareUserInput(userMessage, "run");
		if (preparedInput.cancel) {
			return this.buildAbortedResult(new Date(), "");
		}

		this.conversationStore.appendMessage({
			role: "user",
			content: await this.buildInitialUserContent(
				preparedInput.input,
				userImages,
				userFiles,
			),
		});

		return this.executeLoop(preparedInput.input);
	}

	async continue(
		userMessage: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<AgentResult> {
		this.assertCanStartRun();
		this.log("info", "Agent continue requested", {
			agentId: this.agentId,
			conversationId: this.conversationStore.getConversationId(),
			messageLength: userMessage.length,
		});
		await this.ensureExtensionsInitialized();

		const preparedInput = await this.prepareUserInput(userMessage, "continue");
		if (preparedInput.cancel) {
			return this.buildAbortedResult(new Date(), "");
		}

		this.conversationStore.appendMessage({
			role: "user",
			content: await this.buildInitialUserContent(
				preparedInput.input,
				userImages,
				userFiles,
			),
		});

		return this.executeLoop(preparedInput.input);
	}

	getMessages(): LlmsProviders.Message[] {
		return this.conversationStore.getMessages();
	}

	clearHistory(): void {
		this.conversationStore.clearHistory();
	}

	restore(messages: LlmsProviders.MessageWithMetadata[]): void {
		this.conversationStore.restore(messages);
	}

	abort(reason?: unknown): void {
		if (!this.abortController) {
			return;
		}
		this.log("warn", "Agent abort requested", {
			agentId: this.agentId,
			conversationId: this.conversationStore.getConversationId(),
			runId: this.activeRunId || undefined,
			reason: serializeAbortReason(reason),
		});
		this.abortController.abort(reason);
	}

	subscribeEvents(listener: (event: AgentEvent) => void): () => void {
		return this.runtimeBus.subscribeRuntimeEvent(listener);
	}

	async shutdown(reason?: string): Promise<void> {
		if (this.runState === "running") {
			throw new Error("Cannot shutdown agent while a run is in progress");
		}
		if (this.runState === "shutting_down") {
			return;
		}
		this.runState = "shutting_down";
		try {
			await this.lifecycle.dispatch("hook.session_shutdown", {
				stage: "session_shutdown",
				payload: {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
					parentAgentId: this.parentAgentId,
					reason,
				},
			});
			await this.lifecycle.shutdown();
		} finally {
			this.runState = "idle";
		}
	}

	getExtensionRegistry(): AgentExtensionRegistry {
		return this.contributionRegistry.getRegistrySnapshot();
	}

	getAgentId(): string {
		return this.agentId;
	}

	getConversationId(): string {
		return this.conversationStore.getConversationId();
	}

	canStartRun(): boolean {
		return this.runState === "idle";
	}

	updateConnection(
		overrides: Partial<
			Pick<
				AgentConfig,
				| "providerId"
				| "modelId"
				| "apiKey"
				| "baseUrl"
				| "headers"
				| "knownModels"
				| "reasoningEffort"
				| "thinkingBudgetTokens"
				| "thinking"
				| "abortSignal"
			>
		>,
	): void {
		this.config = {
			...this.config,
			...overrides,
		};
		this.handler = createHandlerFromConfig(this.config, this.logger);
		this.turnProcessor = new TurnProcessor({
			handler: this.handler,
			messageBuilder: this.messageBuilder,
			emit: (event) => this.emit(event),
		});
	}

	private assertCanStartRun(): void {
		if (this.runState === "running") {
			throw new Error(
				"Cannot start a new run while another run is already in progress",
			);
		}
		if (this.runState === "shutting_down") {
			throw new Error("Cannot start a run while agent is shutting down");
		}
	}

	private async executeLoop(triggerMessage: string): Promise<AgentResult> {
		if (this.runState !== "idle") {
			throw new Error(
				`Cannot start agent run while state is "${this.runState}"`,
			);
		}
		this.runState = "running";
		const startedAt = new Date();
		const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
		this.activeRunId = runId;
		this.abortController = new AbortController();
		this.log("info", "Agent loop started", {
			agentId: this.agentId,
			conversationId: this.conversationStore.getConversationId(),
			runId,
			triggerLength: triggerMessage.length,
		});

		const abortSignal = mergeAbortSignals(
			this.config.abortSignal,
			this.abortController.signal,
		);
		const signalCtx = {
			agentId: this.agentId,
			getConversationId: () => this.conversationStore.getConversationId(),
			log: (
				level: "debug" | "info" | "warn" | "error",
				message: string,
				metadata?: Record<string, unknown>,
			) => this.log(level, message, metadata),
		};
		observeAbortSignal(
			this.config.abortSignal,
			"agent_config",
			runId,
			signalCtx,
		);
		observeAbortSignal(
			this.abortController.signal,
			"agent_run",
			runId,
			signalCtx,
		);

		let iteration = 0;
		let finishReason: AgentFinishReason = "completed";
		let finalText = "";
		const allToolCalls: ToolCallRecord[] = [];
		const totalUsage: AgentUsage = {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
			totalCost: undefined,
		};
		let consecutiveMistakes = 0;
		const mistakeDeps: MistakeTrackingDeps = {
			agentId: this.agentId,
			getConversationId: () => this.conversationStore.getConversationId(),
			getActiveRunId: () =>
				this.activeRunId || this.conversationStore.getConversationId(),
			maxConsecutiveMistakes: this.config.maxConsecutiveMistakes,
			onConsecutiveMistakeLimitReached:
				this.config.onConsecutiveMistakeLimitReached,
			emit: (event) => this.emit(event),
			log: (level, message, metadata) => this.log(level, message, metadata),
			appendRecoveryNotice: (message, reason) =>
				this.appendRecoveryNotice(message, reason),
		};

		try {
			if (!this.conversationStore.isSessionStarted()) {
				const sessionStartControl = await this.lifecycle.dispatch(
					"hook.session_start",
					{
						stage: "session_start",
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							parentAgentId: this.parentAgentId,
							schedule: this.config.schedule,
						},
					},
				);
				if (sessionStartControl?.cancel) {
					finishReason = "aborted";
				}
				this.conversationStore.markSessionStarted();
			}

			const runStartControl = await this.lifecycle.dispatch("hook.run_start", {
				stage: "run_start",
				payload: {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
					parentAgentId: this.parentAgentId,
					userMessage: triggerMessage,
				},
			});
			if (runStartControl?.cancel) {
				finishReason = "aborted";
			}

			while (finishReason !== "aborted") {
				if (
					this.config.maxIterations !== undefined &&
					iteration >= this.config.maxIterations
				) {
					finishReason = "max_iterations";
					break;
				}
				if (abortSignal.aborted) {
					finishReason = "aborted";
					break;
				}

				iteration++;
				this.log("debug", "Agent iteration started", {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
					runId,
					iteration,
				});

				const iterationStartControl = await this.lifecycle.dispatch(
					"hook.iteration_start",
					{
						stage: "iteration_start",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							parentAgentId: this.parentAgentId,
							iteration,
						},
					},
				);
				if (iterationStartControl?.cancel) {
					finishReason = "aborted";
					break;
				}

				this.emit({ type: "iteration_start", iteration });

				const turnStartControl = await this.lifecycle.dispatch(
					"hook.turn_start",
					{
						stage: "turn_start",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							parentAgentId: this.parentAgentId,
							iteration,
							messages: this.conversationStore.getMessages(),
						},
					},
				);
				if (turnStartControl?.cancel) {
					finishReason = "aborted";
					break;
				}

				const beforeAgentStartControl = await this.lifecycle.dispatch(
					"hook.before_agent_start",
					{
						stage: "before_agent_start",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							parentAgentId: this.parentAgentId,
							iteration,
							systemPrompt: this.config.systemPrompt,
							messages: this.conversationStore.getMessages(),
						},
					},
				);
				const turnSystemPrompt =
					typeof beforeAgentStartControl?.systemPrompt === "string"
						? beforeAgentStartControl.systemPrompt
						: this.config.systemPrompt;
				if (beforeAgentStartControl?.cancel) {
					finishReason = "aborted";
					break;
				}
				if (
					beforeAgentStartControl?.appendMessages &&
					beforeAgentStartControl.appendMessages.length > 0
				) {
					this.conversationStore.appendMessages(
						beforeAgentStartControl.appendMessages,
					);
				}

				let turn: Awaited<ReturnType<TurnProcessor["processTurn"]>>["turn"];
				let assistantMessage:
					| Awaited<
							ReturnType<TurnProcessor["processTurn"]>
					  >["assistantMessage"]
					| undefined;
				const apiTimeoutSignal = createApiTimeoutSignal(
					this.config.apiTimeoutMs,
				);
				observeAbortSignal(apiTimeoutSignal, "api_timeout", runId, signalCtx);
				const turnAbortSignal = mergeAbortSignals(
					abortSignal,
					apiTimeoutSignal,
				);
				(
					this.handler as LlmsProviders.ApiHandler & {
						setAbortSignal?: (signal: AbortSignal | undefined) => void;
					}
				).setAbortSignal?.(turnAbortSignal);
				try {
					({ turn, assistantMessage } = await this.turnProcessor.processTurn(
						this.conversationStore.getMessages(),
						turnSystemPrompt,
						this.config.tools,
						turnAbortSignal,
					));
				} catch (error) {
					if (abortSignal.aborted) {
						finishReason = "aborted";
						break;
					}
					const errorObj =
						apiTimeoutSignal?.aborted === true
							? new Error(
									`API request timed out after ${this.config.apiTimeoutMs}ms`,
								)
							: error instanceof Error
								? error
								: new Error(String(error));
					const message = errorObj.message;
					if (isNonRecoverableApiError(errorObj)) {
						await this.lifecycle.dispatch("hook.stop_error", {
							stage: "stop_error",
							iteration,
							payload: {
								agentId: this.agentId,
								conversationId: this.conversationStore.getConversationId(),
								parentAgentId: this.parentAgentId,
								iteration,
								error: errorObj,
							},
						});
						throw errorObj;
					}
					this.appendRecoveryNotice(
						`The previous turn failed with an API/runtime error: ${message}. Retry and continue from the latest state.`,
						"api_error",
					);
					const mistakeOutcome = await recordMistake(
						{
							iteration,
							reason: "api_error",
							details: message,
							consecutiveMistakes: () => consecutiveMistakes,
							setConsecutiveMistakes: (value: number) => {
								consecutiveMistakes = value;
							},
						},
						mistakeDeps,
					);
					if (mistakeOutcome.action === "continue") {
						continue;
					}
					this.appendStopNotice(mistakeOutcome.message);
					await this.lifecycle.dispatch("hook.stop_error", {
						stage: "stop_error",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							parentAgentId: this.parentAgentId,
							iteration,
							error: errorObj,
						},
					});
					finishReason = "mistake_limit";
					break;
				}
				if (assistantMessage) {
					this.conversationStore.appendMessage(assistantMessage);
				}

				const turnEndControl = await this.lifecycle.dispatch("hook.turn_end", {
					stage: "turn_end",
					iteration,
					payload: {
						agentId: this.agentId,
						conversationId: this.conversationStore.getConversationId(),
						parentAgentId: this.parentAgentId,
						iteration,
						turn,
					},
				});
				if (turnEndControl?.cancel) {
					finishReason = "aborted";
					break;
				}

				finalText = turn.text;
				totalUsage.inputTokens += turn.usage.inputTokens;
				totalUsage.outputTokens += turn.usage.outputTokens;
				totalUsage.cacheReadTokens =
					(totalUsage.cacheReadTokens ?? 0) + (turn.usage.cacheReadTokens ?? 0);
				totalUsage.cacheWriteTokens =
					(totalUsage.cacheWriteTokens ?? 0) +
					(turn.usage.cacheWriteTokens ?? 0);
				if (typeof turn.usage.cost === "number") {
					totalUsage.totalCost = (totalUsage.totalCost ?? 0) + turn.usage.cost;
				}

				this.emit({
					type: "usage",
					inputTokens: turn.usage.inputTokens,
					outputTokens: turn.usage.outputTokens,
					cacheReadTokens: turn.usage.cacheReadTokens,
					cacheWriteTokens: turn.usage.cacheWriteTokens,
					cost: turn.usage.cost,
					totalInputTokens: totalUsage.inputTokens,
					totalOutputTokens: totalUsage.outputTokens,
					totalCost: totalUsage.totalCost,
				});

				if (turn.invalidToolCalls.length > 0) {
					const feedback = buildInvalidToolCallFeedback(turn.invalidToolCalls);
					this.conversationStore.appendMessage(
						buildInvalidToolResultMessage(turn.invalidToolCalls),
					);
					this.appendRecoveryNotice(feedback, "invalid_tool_call");
					const mistakeOutcome = await recordMistake(
						{
							iteration,
							reason: "invalid_tool_call",
							details: feedback,
							consecutiveMistakes: () => consecutiveMistakes,
							setConsecutiveMistakes: (value: number) => {
								consecutiveMistakes = value;
							},
						},
						mistakeDeps,
					);
					if (mistakeOutcome.action === "continue") {
						continue;
					}
					this.appendStopNotice(mistakeOutcome.message);
					finishReason = "mistake_limit";
					break;
				}

				if (turn.toolCalls.length === 0) {
					consecutiveMistakes = 0;
					// Check completion guard before allowing the loop to end.
					// If the guard returns a nudge string, inject it and continue.
					const guardNudge = this.config.completionGuard?.();
					if (guardNudge) {
						this.log("info", "Completion guard prevented early exit", {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							runId,
							iteration,
						});
						this.conversationStore.appendMessage({
							role: "user",
							content: [{ type: "text", text: guardNudge }],
						});
						continue;
					}

					this.emit({
						type: "iteration_end",
						iteration,
						hadToolCalls: false,
						toolCallCount: 0,
					});
					await this.lifecycle.dispatch("hook.iteration_end", {
						stage: "iteration_end",
						iteration,
						payload: {
							agentId: this.agentId,
							conversationId: this.conversationStore.getConversationId(),
							parentAgentId: this.parentAgentId,
							iteration,
							hadToolCalls: false,
							toolCallCount: 0,
						},
					});
					finishReason = "completed";
					break;
				}

				const context: ToolContext = {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
					iteration,
					abortSignal,
					metadata: this.config.toolContextMetadata
						? { ...this.config.toolContextMetadata }
						: undefined,
				};
				const { results: toolResults, cancelRequested } =
					await this.toolOrchestrator.execute(
						this.toolRegistry,
						turn.toolCalls,
						context,
						{ iteration, runId },
						{ maxConcurrency: this.config.maxParallelToolCalls },
					);

				allToolCalls.push(...toolResults);
				this.conversationStore.appendMessage(
					this.toolOrchestrator.buildToolResultMessage(toolResults, iteration, {
						afterIterations: this.config.reminderAfterIterations,
						text: this.config.reminderText,
					}),
				);
				const successfulToolCalls = toolResults.filter(
					(record) => !record.error,
				).length;
				const failedToolCalls = toolResults.length - successfulToolCalls;
				if (successfulToolCalls > 0) {
					consecutiveMistakes = 0;
				} else if (failedToolCalls > 0) {
					const failedToolCallDetails =
						buildFailedToolCallFeedback(toolResults);
					const mistakeOutcome = await recordMistake(
						{
							iteration,
							reason: "tool_execution_failed",
							details: `${failedToolCalls} tool call(s) failed${
								failedToolCallDetails ? `: ${failedToolCallDetails}` : ""
							}`,
							consecutiveMistakes: () => consecutiveMistakes,
							setConsecutiveMistakes: (value: number) => {
								consecutiveMistakes = value;
							},
						},
						mistakeDeps,
					);
					if (mistakeOutcome.action === "stop") {
						this.appendStopNotice(mistakeOutcome.message);
						finishReason = "mistake_limit";
						break;
					}
				}

				this.emit({
					type: "iteration_end",
					iteration,
					hadToolCalls: true,
					toolCallCount: turn.toolCalls.length,
				});
				await this.lifecycle.dispatch("hook.iteration_end", {
					stage: "iteration_end",
					iteration,
					payload: {
						agentId: this.agentId,
						conversationId: this.conversationStore.getConversationId(),
						parentAgentId: this.parentAgentId,
						iteration,
						hadToolCalls: true,
						toolCallCount: turn.toolCalls.length,
					},
				});
				if (cancelRequested) {
					this.log("warn", "Agent iteration cancelled by tool lifecycle", {
						agentId: this.agentId,
						conversationId: this.conversationStore.getConversationId(),
						runId,
						iteration,
					});
					finishReason = "aborted";
					break;
				}
				this.log("debug", "Agent iteration finished", {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
					runId,
					iteration,
					toolCalls: turn.toolCalls.length,
				});
			}
		} catch (error) {
			finishReason = "error";
			this.log("error", "Agent loop failed", {
				agentId: this.agentId,
				conversationId: this.conversationStore.getConversationId(),
				runId,
				error,
			});
			const errorObj =
				error instanceof Error ? error : new Error(String(error));
			await this.lifecycle.dispatch("hook.error", {
				stage: "error",
				iteration,
				payload: {
					agentId: this.agentId,
					conversationId: this.conversationStore.getConversationId(),
					parentAgentId: this.parentAgentId,
					iteration,
					error: errorObj,
				},
			});
			this.emit({
				type: "error",
				error: errorObj,
				recoverable: false,
				iteration,
			});
			throw error;
		} finally {
			this.abortController = null;
			this.activeRunId = "";
			if (this.runState === "running") {
				this.runState = "idle";
			}
		}

		const endedAt = new Date();
		const durationMs = endedAt.getTime() - startedAt.getTime();
		const modelInfo = this.handler.getModel();

		this.emit({
			type: "done",
			reason: finishReason,
			text: finalText,
			iterations: iteration,
		});
		this.log("info", "Agent loop finished", {
			agentId: this.agentId,
			conversationId: this.conversationStore.getConversationId(),
			runId,
			finishReason,
			iterations: iteration,
			durationMs,
		});

		const result = {
			text: finalText,
			usage: totalUsage,
			messages: this.conversationStore.getMessages(),
			toolCalls: allToolCalls,
			iterations: iteration,
			finishReason,
			model: {
				id: modelInfo.id,
				provider: this.config.providerId,
				info: modelInfo.info,
			},
			startedAt,
			endedAt,
			durationMs,
		};
		await this.lifecycle.dispatch("hook.run_end", {
			stage: "run_end",
			iteration,
			payload: {
				agentId: this.agentId,
				conversationId: this.conversationStore.getConversationId(),
				parentAgentId: this.parentAgentId,
				result,
			},
		});
		await this.lifecycle.shutdown();
		return result;
	}

	private async ensureExtensionsInitialized(): Promise<void> {
		if (this.extensionsInitialized) {
			return;
		}

		try {
			await this.contributionRegistry.initialize();
		} catch (error) {
			if (this.config.hookErrorMode === "throw") {
				throw error;
			}
			this.emit({
				type: "error",
				error: error instanceof Error ? error : new Error(String(error)),
				recoverable: true,
				iteration: 0,
			});
		}
		const mergedTools = [
			...this.config.tools,
			...this.contributionRegistry.getRegisteredTools(),
		];
		validateTools(mergedTools);
		this.config.tools = mergedTools;
		this.toolRegistry = createToolRegistry(mergedTools);
		this.extensionsInitialized = true;
	}

	private async prepareUserInput(
		userMessage: string,
		mode: "run" | "continue",
	): Promise<{ input: string; cancel: boolean }> {
		const control = await this.lifecycle.dispatch("hook.input", {
			stage: "input",
			payload: {
				agentId: this.agentId,
				conversationId: this.conversationStore.getConversationId(),
				parentAgentId: this.parentAgentId,
				mode,
				input: userMessage,
			},
		});
		const input =
			Object.hasOwn(control ?? {}, "overrideInput") &&
			typeof control?.overrideInput === "string"
				? control.overrideInput
				: userMessage;
		if (control?.cancel) {
			return { input, cancel: true };
		}
		return { input, cancel: false };
	}

	private async buildInitialUserContent(
		userMessage: string,
		userImages?: string[],
		userFiles?: string[],
	): Promise<string | LlmsProviders.ContentBlock[]> {
		return buildInitialUserContent(
			userMessage,
			userImages,
			userFiles,
			this.config.userFileContentLoader,
		);
	}

	private buildAbortedResult(startedAt: Date, text: string): AgentResult {
		const endedAt = new Date();
		const modelInfo = this.handler.getModel();
		return {
			text,
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				totalCost: undefined,
			},
			messages: this.conversationStore.getMessages(),
			toolCalls: [],
			iterations: 0,
			finishReason: "aborted",
			model: {
				id: modelInfo.id,
				provider: this.config.providerId,
				info: modelInfo.info,
			},
			startedAt,
			endedAt,
			durationMs: endedAt.getTime() - startedAt.getTime(),
		};
	}

	private emit(event: AgentEvent): void {
		this.runtimeBus.emitRuntimeEvent(event);
	}

	private reportRecoverableError(error: unknown): void {
		this.log("warn", "Recoverable agent error", {
			agentId: this.agentId,
			conversationId: this.conversationStore.getConversationId(),
			runId: this.activeRunId || this.conversationStore.getConversationId(),
			error,
		});
		this.emit({
			type: "error",
			error: error instanceof Error ? error : new Error(String(error)),
			recoverable: this.config.hookErrorMode !== "throw",
			iteration: 0,
		});
	}

	private resolveToolPolicy(toolName: string): ToolPolicy {
		const globalPolicy = this.config.toolPolicies?.["*"] ?? {};
		const toolPolicy = this.config.toolPolicies?.[toolName] ?? {};
		return {
			...globalPolicy,
			...toolPolicy,
		};
	}

	private async requestToolApproval(
		toolName: string,
		toolCallId: string,
		input: unknown,
		context: ToolContext,
		policy: ToolPolicy,
	): Promise<ToolApprovalResult> {
		const callback = this.config.requestToolApproval;
		if (!callback) {
			return {
				approved: false,
				reason: `Tool "${toolName}" requires approval but no approval handler is configured`,
			};
		}
		try {
			const result = await callback({
				agentId: this.agentId,
				conversationId: this.conversationStore.getConversationId(),
				iteration: context.iteration,
				toolCallId,
				toolName,
				input,
				policy,
			});
			return result;
		} catch (error) {
			return {
				approved: false,
				reason: error instanceof Error ? error.message : String(error),
			};
		}
	}

	private async authorizeToolCall(
		call: PendingToolCall,
		context: ToolContext,
	): Promise<{ allowed: true } | { allowed: false; reason: string }> {
		const policy = this.resolveToolPolicy(call.name);
		const enabled = policy.enabled !== false;
		if (!enabled) {
			return {
				allowed: false,
				reason: `Tool "${call.name}" is disabled by policy`,
			};
		}

		const autoApprove = policy.autoApprove !== false && call.review !== true;
		if (autoApprove) {
			return { allowed: true };
		}

		const approval = await this.requestToolApproval(
			call.name,
			call.id,
			call.input,
			context,
			call.review === true ? { ...policy, autoApprove: false } : policy,
		);
		if (!approval.approved) {
			return {
				allowed: false,
				reason:
					approval.reason?.trim() || `Tool "${call.name}" was not approved`,
			};
		}
		return { allowed: true };
	}

	private appendHookContext(source: string, context: string): void {
		const trimmed = context.trim();
		if (!trimmed) {
			return;
		}

		const text = trimmed.startsWith("<hook_context")
			? trimmed
			: `<hook_context source="${source}">\n${trimmed}\n</hook_context>`;

		this.conversationStore.appendMessage({
			role: "user",
			content: [
				{
					type: "text",
					text,
				},
			],
		});
	}

	private appendRecoveryNotice(
		message: string,
		reason: "api_error" | "invalid_tool_call" | "tool_execution_failed",
	): void {
		const text = message.trim();
		if (!text) {
			return;
		}
		const metadata = {
			kind: "recovery_notice",
			reason,
			displayRole: "system",
		} as const;
		this.conversationStore.appendMessage({
			role: "user",
			content: [{ type: "text", text }],
			metadata,
		});
		this.emit({
			type: "notice",
			noticeType: "recovery",
			message: text,
			displayRole: "system",
			reason,
			metadata: { ...metadata },
		});
	}

	private appendStopNotice(message: string): void {
		const text = message.trim();
		if (!text) {
			return;
		}
		const metadata = {
			kind: "stop_notice",
			reason: "mistake_limit",
			displayRole: "status",
		} as const;
		this.conversationStore.appendMessage({
			role: "user",
			content: [{ type: "text", text }],
			metadata,
		});
		this.emit({
			type: "notice",
			noticeType: "stop",
			message: text,
			displayRole: "status",
			reason: "mistake_limit",
			metadata: { ...metadata },
		});
	}

	private log(
		level: "debug" | "info" | "warn" | "error",
		message: string,
		metadata?: Record<string, unknown>,
	): void {
		const sink = this.logger?.[level];
		if (!sink) {
			return;
		}
		try {
			if (level === "error") {
				const errorMeta =
					metadata?.error instanceof Error
						? {
								...metadata,
								error: {
									name: metadata.error.name,
									message: metadata.error.message,
									stack: metadata.error.stack,
								},
							}
						: metadata;
				sink(message, errorMeta);
				return;
			}
			sink(message, metadata);
		} catch {
			// Logging failures must never break agent execution.
		}
	}
}

export function createAgent(config: AgentConfig): Agent {
	return new Agent(config);
}
