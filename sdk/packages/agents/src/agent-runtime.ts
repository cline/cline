import { createGateway } from "@clinebot/llms";
import type {
	AgentAfterToolResult,
	AgentBeforeModelResult,
	AgentBeforeToolResult,
	AgentMessage,
	AgentMessagePart,
	AgentModel,
	AgentModelFinishReason,
	AgentModelRequest,
	AgentRunResult,
	AgentRuntimeEvent,
	AgentRuntimeHooks,
	AgentRuntimeStateSnapshot,
	AgentStopControl,
	AgentTool,
	AgentToolCallPart,
	AgentToolDefinition,
	AgentToolResult,
	AgentUsage,
	AgentRuntimeConfig as BaseAgentRuntimeConfig,
	ToolApprovalResult,
	ToolPolicy,
} from "@clinebot/shared";
import { nanoid } from "nanoid";

// Local `createUID` helper. The clinee source imports this from
// `@clinebot/shared` (see `packages/shared/dist/identifier.ts`), but
// sdk-re's shared package does not expose it yet. Inlining here keeps
// PLAN.md Step 1 scoped to `packages/agents/src/` and matches the
// exact clinee implementation (`${prefix}_${nanoid(length)}`).
function createUID(prefix: string, length = 8): string {
	return `${prefix}_${nanoid(length)}`;
}

export type AgentRunInput = string | AgentMessage | readonly AgentMessage[];
export type AgentEventListener = (event: AgentRuntimeEvent) => void;

/**
 * Advanced form: caller supplies a pre-built `AgentModel`. Used by
 * `@clinebot/core`, which constructs models itself to share gateway/telemetry
 * wiring with the rest of the session runtime.
 */
export interface AgentRuntimeConfigWithModel extends BaseAgentRuntimeConfig {
	model: AgentModel;
}

/**
 * Friendly form: caller supplies provider/model IDs and credentials, and the
 * runtime builds an `AgentModel` internally via `@clinebot/llms`. This is the
 * entry point most standalone users want.
 */
export interface AgentRuntimeConfigWithProvider
	extends Omit<BaseAgentRuntimeConfig, "model"> {
	/** Provider ID (e.g., "anthropic", "openai") */
	providerId: string;
	/** Model ID to use */
	modelId: string;
	/** API key for the provider */
	apiKey?: string;
	/** Custom base URL for the API */
	baseUrl?: string;
	/** Additional headers for API requests */
	headers?: Record<string, string>;
}

/**
 * Config accepted by `new AgentRuntime(...)` / `createAgentRuntime(...)` /
 * `new Agent(...)` / `createAgent(...)`. Either supply a pre-built `model`
 * (advanced) or `providerId` + `modelId` (+ credentials) and the runtime will
 * construct the model itself via `@clinebot/llms`.
 */
export type AgentRuntimeConfig =
	| AgentRuntimeConfigWithModel
	| AgentRuntimeConfigWithProvider;

function hasPrebuiltModel(
	config: AgentRuntimeConfig,
): config is AgentRuntimeConfigWithModel {
	return (config as AgentRuntimeConfigWithModel).model !== undefined;
}

function resolveRuntimeConfig(
	config: AgentRuntimeConfig,
): BaseAgentRuntimeConfig {
	if (hasPrebuiltModel(config)) {
		return config;
	}
	const { providerId, modelId, apiKey, baseUrl, headers, ...rest } = config;
	const gateway = createGateway({
		providerConfigs: [{ providerId, apiKey, baseUrl, headers }],
	});
	const model = gateway.createAgentModel({ providerId, modelId });
	return { ...rest, model };
}

function resolveToolPolicy(
	toolName: string,
	policies: BaseAgentRuntimeConfig["toolPolicies"],
): ToolPolicy {
	return {
		...(policies?.["*"] ?? {}),
		...(policies?.[toolName] ?? {}),
	};
}

interface PendingToolAssembly {
	toolCallId: string;
	toolName?: string;
	inputText: string;
	inputValue?: unknown;
	metadata?: unknown;
	parseError?: string;
}

interface InvalidToolCall {
	toolCallId: string;
	toolName?: string;
	input: Record<string, unknown>;
	reason: "missing_name" | "missing_arguments" | "invalid_arguments";
}

interface PreparedToolExecution {
	toolCall: AgentToolCallPart;
	tool?: AgentTool;
	input: unknown;
	skipReason?: string;
}

interface HookBag {
	beforeRun: NonNullable<AgentRuntimeHooks["beforeRun"]>[];
	afterRun: NonNullable<AgentRuntimeHooks["afterRun"]>[];
	beforeModel: NonNullable<AgentRuntimeHooks["beforeModel"]>[];
	afterModel: NonNullable<AgentRuntimeHooks["afterModel"]>[];
	beforeTool: NonNullable<AgentRuntimeHooks["beforeTool"]>[];
	afterTool: NonNullable<AgentRuntimeHooks["afterTool"]>[];
	onEvent: NonNullable<AgentRuntimeHooks["onEvent"]>[];
}

class ControlledStopError extends Error {
	readonly reason?: string;

	constructor(reason?: string) {
		super(reason ?? "Run stopped by runtime control");
		this.name = "ControlledStopError";
		this.reason = reason;
	}
}

const DEFAULT_USAGE: AgentUsage = {
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
};

function createMessage(
	role: AgentMessage["role"],
	content: AgentMessagePart[],
	metadata?: Record<string, unknown>,
): AgentMessage {
	return {
		id: createUID("msg"),
		role,
		content,
		createdAt: Date.now(),
		metadata,
	};
}

function cloneUsage(usage: AgentUsage): AgentUsage {
	return { ...usage };
}

function cloneMessages(messages: readonly AgentMessage[]): AgentMessage[] {
	return messages.map((message) => ({
		...message,
		content: message.content.map((part: AgentMessagePart) => ({ ...part })),
		metadata: message.metadata ? { ...message.metadata } : undefined,
		modelInfo: message.modelInfo ? { ...message.modelInfo } : undefined,
		metrics: message.metrics ? { ...message.metrics } : undefined,
	}));
}

function usageDelta(
	start: AgentUsage,
	end: AgentUsage,
): NonNullable<AgentMessage["metrics"]> | undefined {
	const inputTokens = Math.max(
		0,
		(end.inputTokens ?? 0) - (start.inputTokens ?? 0),
	);
	const outputTokens = Math.max(
		0,
		(end.outputTokens ?? 0) - (start.outputTokens ?? 0),
	);
	const cacheReadTokens = Math.max(
		0,
		(end.cacheReadTokens ?? 0) - (start.cacheReadTokens ?? 0),
	);
	const cacheWriteTokens = Math.max(
		0,
		(end.cacheWriteTokens ?? 0) - (start.cacheWriteTokens ?? 0),
	);
	const startCost = start.totalCost ?? 0;
	const endCost = end.totalCost ?? 0;
	const cost = Math.max(0, endCost - startCost);
	if (
		inputTokens === 0 &&
		outputTokens === 0 &&
		cacheReadTokens === 0 &&
		cacheWriteTokens === 0 &&
		cost === 0
	) {
		return undefined;
	}
	return {
		inputTokens: inputTokens > 0 ? inputTokens : 0,
		outputTokens: outputTokens > 0 ? outputTokens : 0,
		cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : 0,
		cacheWriteTokens: cacheWriteTokens > 0 ? cacheWriteTokens : 0,
		...(cost > 0 ? { cost } : {}),
	};
}

function textFromMessage(message: AgentMessage | undefined): string {
	if (!message) {
		return "";
	}
	return message.content
		.filter(
			(
				part: AgentMessagePart,
			): part is Extract<AgentMessagePart, { type: "text" }> =>
				part.type === "text",
		)
		.map((part: Extract<AgentMessagePart, { type: "text" }>) => part.text)
		.join("");
}

function textFromToolMessage(message: AgentMessage | undefined): string {
	const result = message?.content.find(
		(part): part is Extract<AgentMessagePart, { type: "tool-result" }> =>
			part.type === "tool-result",
	);
	if (!result || result.isError) {
		return "";
	}
	if (typeof result.output === "string") {
		return result.output;
	}
	try {
		return JSON.stringify(result.output);
	} catch {
		return String(result.output);
	}
}

function normalizeInput(input: AgentRunInput): AgentMessage[] {
	if (typeof input === "string") {
		return [createMessage("user", [{ type: "text", text: input }])];
	}
	if (Array.isArray(input)) {
		return cloneMessages(input);
	}
	return cloneMessages([input as AgentMessage]);
}

export class AgentRuntime {
	private config: Required<Pick<BaseAgentRuntimeConfig, "toolExecution">> &
		BaseAgentRuntimeConfig;
	private readonly listeners = new Set<AgentEventListener>();
	// biome-ignore lint/suspicious/noExplicitAny: tool input/output types vary per tool
	private readonly tools = new Map<string, AgentTool<any, any>>();
	private hooks: HookBag = {
		beforeRun: [],
		afterRun: [],
		beforeModel: [],
		afterModel: [],
		beforeTool: [],
		afterTool: [],
		onEvent: [],
	};
	private readonly state = {
		agentId: "",
		agentRole: undefined as string | undefined,
		parentAgentId: undefined as string | null | undefined,
		runId: undefined as string | undefined,
		status: "idle" as AgentRuntimeStateSnapshot["status"],
		iteration: 0,
		messages: [] as AgentMessage[],
		pendingToolCalls: [] as string[],
		usage: cloneUsage(DEFAULT_USAGE),
		lastError: undefined as string | undefined,
	};
	private initialization?: Promise<void>;
	private abortController?: AbortController;

	constructor(config: AgentRuntimeConfig) {
		const resolved = resolveRuntimeConfig(config);
		this.config = {
			...resolved,
			toolExecution: resolved.toolExecution ?? "sequential",
		};
		this.state.agentId = resolved.agentId ?? createUID("agent");
		this.state.agentRole = resolved.agentRole;
		this.state.parentAgentId = resolved.parentAgentId;
		this.state.messages = cloneMessages(resolved.initialMessages ?? []);
	}

	async run(input: AgentRunInput): Promise<AgentRunResult> {
		return this.execute(input);
	}

	async continue(input?: AgentRunInput): Promise<AgentRunResult> {
		return this.execute(input);
	}

	abort(reason?: string): void {
		if (!this.abortController) {
			return;
		}
		this.state.lastError = reason ?? "Run aborted";
		this.abortController.abort(new Error(reason ?? "Run aborted"));
	}

	subscribe(listener: AgentEventListener): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}

	/**
	 * Replace the conversation with a fresh set of messages, discarding any
	 * in-flight run and usage state while preserving the underlying model,
	 * tools, hooks, plugins, and active event subscribers.
	 *
	 * Useful for standalone callers that persist conversations externally and
	 * want to re-seed the runtime from storage without recreating subscribers.
	 */
	restore(messages: readonly AgentMessage[]): void {
		this.abort("Agent state restored");
		// Reset state that is not carried across restores. Keep `listeners`,
		// tools, hooks, plugins, model, and agent identity so external event
		// subscribers continue to receive events after restore().
		this.state.runId = undefined;
		this.state.status = "idle";
		this.state.iteration = 0;
		this.state.pendingToolCalls = [];
		this.state.usage = cloneUsage(DEFAULT_USAGE);
		this.state.lastError = undefined;
		this.state.messages = cloneMessages(messages);
		this.config = {
			...this.config,
			initialMessages: cloneMessages(messages),
		};
	}

	snapshot(): AgentRuntimeStateSnapshot {
		return {
			agentId: this.state.agentId,
			agentRole: this.state.agentRole,
			parentAgentId: this.state.parentAgentId,
			conversationId: this.config.conversationId?.trim() || undefined,
			runId: this.state.runId,
			status: this.state.status,
			iteration: this.state.iteration,
			messages: cloneMessages(this.state.messages),
			pendingToolCalls: [...this.state.pendingToolCalls],
			usage: cloneUsage(this.state.usage),
			lastError: this.state.lastError,
		};
	}

	private async ensureInitialized(): Promise<void> {
		this.initialization ??= this.initialize();
		await this.initialization;
	}

	private async initialize(): Promise<void> {
		this.registerHooks(this.config.hooks);
		for (const tool of this.config.tools ?? []) {
			this.tools.set(tool.name, tool);
		}
		for (const plugin of this.config.plugins ?? []) {
			const setup = await plugin.setup?.({
				agentId: this.state.agentId,
				agentRole: this.state.agentRole,
				systemPrompt: this.config.systemPrompt,
			});
			for (const tool of setup?.tools ?? []) {
				this.tools.set(tool.name, tool);
			}
			this.registerHooks(setup?.hooks);
		}
	}

	private registerHooks(hooks: Partial<AgentRuntimeHooks> | undefined): void {
		if (!hooks) {
			return;
		}
		if (hooks.beforeRun) this.hooks.beforeRun.push(hooks.beforeRun);
		if (hooks.afterRun) this.hooks.afterRun.push(hooks.afterRun);
		if (hooks.beforeModel) this.hooks.beforeModel.push(hooks.beforeModel);
		if (hooks.afterModel) this.hooks.afterModel.push(hooks.afterModel);
		if (hooks.beforeTool) this.hooks.beforeTool.push(hooks.beforeTool);
		if (hooks.afterTool) this.hooks.afterTool.push(hooks.afterTool);
		if (hooks.onEvent) this.hooks.onEvent.push(hooks.onEvent);
	}

	private getRequiredCompletionToolNames(): string[] {
		if (this.config.completionPolicy?.requireCompletionTool !== true) {
			return [];
		}
		return [...this.tools.values()]
			.filter((tool) => tool.lifecycle?.completesRun === true)
			.map((tool) => tool.name)
			.sort();
	}

	private getCompletionToolReminderMessage(): string | undefined {
		const terminalToolNames = this.getRequiredCompletionToolNames();
		if (terminalToolNames.length === 0) {
			return undefined;
		}
		return `[SYSTEM] This run is not complete until you call one of these terminal completion tools: ${terminalToolNames.join(
			", ",
		)}. Continue working if requirements are not met. If the task is complete, call the appropriate terminal completion tool now.`;
	}

	private getCompletionReminderMessages(): string[] {
		return [
			this.getCompletionToolReminderMessage(),
			this.config.completionPolicy?.completionGuard?.(),
		].filter((message): message is string => Boolean(message));
	}

	private async addUserReminderMessage(text: string): Promise<AgentMessage> {
		const reminderMessage = createMessage("user", [{ type: "text", text }]);
		this.state.messages.push(reminderMessage);
		await this.emit({
			type: "message-added",
			snapshot: this.snapshot(),
			message: reminderMessage,
		});
		return reminderMessage;
	}

	private async execute(input?: AgentRunInput): Promise<AgentRunResult> {
		await this.ensureInitialized();
		if (this.state.status === "running") {
			throw new Error("Agent runtime is already running");
		}

		this.abortController = new AbortController();
		this.state.runId = createUID("run");
		this.state.status = "running";
		this.state.iteration = 0;
		this.state.pendingToolCalls = [];
		this.state.lastError = undefined;

		try {
			await this.callBeforeRunHooks();
			await this.emit({ type: "run-started", snapshot: this.snapshot() });

			for (const message of input ? normalizeInput(input) : []) {
				this.state.messages.push(message);
				await this.emit({
					type: "message-added",
					snapshot: this.snapshot(),
					message,
				});
			}

			const completionToolReminder = this.getCompletionToolReminderMessage();
			if (completionToolReminder) {
				await this.addUserReminderMessage(completionToolReminder);
			}

			let finalAssistantMessage: AgentMessage | undefined;

			while (
				this.config.maxIterations === undefined ||
				this.state.iteration < this.config.maxIterations
			) {
				this.throwIfAborted();

				this.state.iteration += 1;
				await this.emit({
					type: "turn-started",
					snapshot: this.snapshot(),
					iteration: this.state.iteration,
				});

				const { message, finishReason } = await this.generateAssistantMessage();
				finalAssistantMessage = message;
				this.state.messages.push(message);
				await this.emit({
					type: "message-added",
					snapshot: this.snapshot(),
					message,
				});
				await this.emit({
					type: "assistant-message",
					snapshot: this.snapshot(),
					iteration: this.state.iteration,
					message,
					finishReason,
				});

				if (finishReason === "aborted") {
					throw this.normalizeAbortError();
				}

				const toolCalls = message.content.filter(
					(part: AgentMessagePart): part is AgentToolCallPart =>
						part.type === "tool-call",
				);
				if (finishReason === "error" && toolCalls.length === 0) {
					throw new Error(this.state.lastError ?? "Model stream failed");
				}
				this.state.pendingToolCalls = toolCalls.map((part) => part.toolCallId);

				if (toolCalls.length === 0) {
					await this.emit({
						type: "turn-finished",
						snapshot: this.snapshot(),
						iteration: this.state.iteration,
						toolCallCount: 0,
					});
					const completionReminderMessages =
						this.getCompletionReminderMessages();
					if (completionReminderMessages.length > 0) {
						for (const reminderMessage of completionReminderMessages) {
							await this.addUserReminderMessage(reminderMessage);
						}
						continue;
					}
					const result = this.finishRun("completed", finalAssistantMessage);
					await this.callAfterRunHooks(result);
					await this.emit({
						type: "run-finished",
						snapshot: this.snapshot(),
						result,
					});
					return result;
				}

				const toolMessages = await this.executeToolCalls(toolCalls);
				this.state.pendingToolCalls = [];
				for (const toolMessage of toolMessages) {
					this.state.messages.push(toolMessage);
					await this.emit({
						type: "message-added",
						snapshot: this.snapshot(),
						message: toolMessage,
					});
				}
				await this.emit({
					type: "turn-finished",
					snapshot: this.snapshot(),
					iteration: this.state.iteration,
					toolCallCount: toolCalls.length,
				});
				const terminalToolMessage = this.findCompletingToolMessage(
					toolCalls,
					toolMessages,
				);
				if (terminalToolMessage) {
					const result = this.finishRun(
						"completed",
						finalAssistantMessage,
						textFromToolMessage(terminalToolMessage) || undefined,
					);
					await this.callAfterRunHooks(result);
					await this.emit({
						type: "run-finished",
						snapshot: this.snapshot(),
						result,
					});
					return result;
				}
			}

			throw new Error(
				`Agent runtime exceeded maxIterations (${this.config.maxIterations})`,
			);
		} catch (error) {
			const normalized =
				error instanceof Error ? error : new Error(String(error));
			const isControlledStop = normalized instanceof ControlledStopError;
			const status =
				this.abortController.signal.aborted || isControlledStop
					? "aborted"
					: "failed";
			this.state.status = status;
			this.state.lastError = normalized.message;
			const result: AgentRunResult = {
				agentId: this.state.agentId,
				agentRole: this.state.agentRole,
				runId: this.state.runId ?? createUID("run"),
				status,
				iterations: this.state.iteration,
				outputText: textFromMessage(this.findLastAssistantMessage()),
				messages: cloneMessages(this.state.messages),
				usage: cloneUsage(this.state.usage),
				error: status === "failed" ? normalized : undefined,
			};
			await this.callAfterRunHooks(result);
			if (status === "failed") {
				await this.emit({
					type: "run-failed",
					snapshot: this.snapshot(),
					error: normalized,
				});
			} else {
				await this.emit({
					type: "run-finished",
					snapshot: this.snapshot(),
					result,
				});
			}
			return result;
		} finally {
			this.abortController = undefined;
		}
	}

	private async callBeforeRunHooks(): Promise<void> {
		for (const hook of this.hooks.beforeRun) {
			const control = (await hook({
				snapshot: this.snapshot(),
			})) as AgentStopControl | undefined;
			this.applyStopControl(control);
		}
	}

	private async callAfterRunHooks(result: AgentRunResult): Promise<void> {
		for (const hook of this.hooks.afterRun) {
			await hook({ snapshot: this.snapshot(), result });
		}
	}

	private async generateAssistantMessage(): Promise<{
		message: AgentMessage;
		finishReason: AgentModelFinishReason;
	}> {
		const usageBeforeModel = cloneUsage(this.state.usage);
		let request: AgentModelRequest = {
			systemPrompt: this.config.systemPrompt,
			messages: cloneMessages(this.state.messages),
			tools: [...this.tools.values()].map<AgentToolDefinition>((tool) => ({
				name: tool.name,
				description: tool.description,
				inputSchema: tool.inputSchema,
			})),
			signal: this.abortController?.signal,
			options: this.config.modelOptions,
		};

		request = await this.prepareTurnForModelRequest(request);

		for (const hook of this.hooks.beforeModel) {
			const result = (await hook({
				snapshot: this.snapshot(),
				request,
			})) as AgentBeforeModelResult | undefined;
			this.applyStopControl(result);
			if (result?.messages) {
				request = { ...request, messages: cloneMessages(result.messages) };
			}
			if (result?.tools) {
				request = { ...request, tools: [...result.tools] };
			}
			if (result?.options) {
				request = {
					...request,
					options: { ...(request.options ?? {}), ...result.options },
				};
			}
		}

		const stream = await this.config.model.stream(request);
		const content: AgentMessagePart[] = [];
		const toolAssemblies = new Map<string, PendingToolAssembly>();
		const invalidToolCalls: InvalidToolCall[] = [];
		const sequence: Array<
			{ type: "tool"; key: string } | { type: "part"; part: AgentMessagePart }
		> = [];
		let nextToolIndex = 0;
		let finishReason: AgentModelFinishReason = "stop";
		let accumulatedText = "";
		let accumulatedReasoning = "";

		for await (const event of stream) {
			this.throwIfAborted();
			switch (event.type) {
				case "text-delta": {
					accumulatedText += event.text;
					const last = sequence.at(-1);
					if (last?.type === "part" && last.part.type === "text") {
						last.part.text += event.text;
					} else {
						sequence.push({
							type: "part",
							part: { type: "text", text: event.text },
						});
					}
					await this.emit({
						type: "assistant-text-delta",
						snapshot: this.snapshot(),
						iteration: this.state.iteration,
						text: event.text,
						accumulatedText,
					});
					break;
				}
				case "reasoning-delta": {
					accumulatedReasoning += event.text;
					const last = sequence.at(-1);
					if (last?.type === "part" && last.part.type === "reasoning") {
						last.part.text += event.text;
						last.part.redacted = event.redacted ?? last.part.redacted;
						last.part.metadata = event.metadata ?? last.part.metadata;
					} else {
						sequence.push({
							type: "part",
							part: {
								type: "reasoning",
								text: event.text,
								redacted: event.redacted,
								metadata: event.metadata,
							},
						});
					}
					await this.emit({
						type: "assistant-reasoning-delta",
						snapshot: this.snapshot(),
						iteration: this.state.iteration,
						text: event.text,
						accumulatedText: accumulatedReasoning,
						redacted: event.redacted,
						metadata: event.metadata,
					});
					break;
				}
				case "tool-call-delta": {
					const key =
						event.toolCallId ?? `tool_${event.index ?? nextToolIndex}`;
					if (event.index == null && event.toolCallId == null) {
						nextToolIndex += 1;
					}
					let assembly = toolAssemblies.get(key);
					if (!assembly) {
						assembly = {
							toolCallId: event.toolCallId ?? createUID("tool"),
							inputText: "",
						};
						toolAssemblies.set(key, assembly);
						sequence.push({ type: "tool", key });
					}
					if (event.toolCallId) {
						assembly.toolCallId = event.toolCallId;
					}
					if (event.toolName) {
						assembly.toolName = event.toolName;
					}
					if (event.input !== undefined) {
						assembly.inputValue = event.input;
					}
					if (event.metadata !== undefined) {
						assembly.metadata = mergeToolMetadata(
							assembly.metadata,
							event.metadata,
						);
					}
					if (event.inputText) {
						assembly.inputText = mergeToolInputText(
							assembly.inputText,
							event.inputText,
						);
					}
					break;
				}
				case "usage": {
					await this.updateUsage(event.usage);
					break;
				}
				case "finish": {
					finishReason = event.reason;
					if (event.error) {
						this.state.lastError = event.error;
					}
					break;
				}
			}
		}

		for (const item of sequence) {
			if (item.type === "part") {
				content.push(item.part);
				continue;
			}
			const assembly = toolAssemblies.get(item.key);
			if (!assembly?.toolName) {
				invalidToolCalls.push({
					toolCallId: assembly?.toolCallId ?? item.key,
					input: buildInvalidToolInput(assembly?.inputText ?? ""),
					reason: "missing_name",
				});
				continue;
			}
			const parsed = parseToolInput(assembly);
			if (parsed.reason) {
				invalidToolCalls.push({
					toolCallId: assembly.toolCallId,
					toolName: assembly.toolName,
					input: parsed.invalidInput,
					reason: parsed.reason,
				});
			}
			content.push({
				type: "tool-call",
				toolCallId: assembly.toolCallId,
				toolName: assembly.toolName,
				input: parsed.input,
				metadata: parsed.parseError
					? mergeToolMetadata(assembly.metadata, {
							inputParseError: parsed.parseError,
							rawInputText: assembly.inputText,
						})
					: assembly.metadata,
			});
		}

		const message = createMessage(
			"assistant",
			content,
			invalidToolCalls.length > 0 ? { invalidToolCalls } : undefined,
		);
		const metrics = usageDelta(usageBeforeModel, this.state.usage);
		if (metrics) {
			message.metrics = metrics;
		}
		if (this.config.messageModelInfo) {
			message.modelInfo = { ...this.config.messageModelInfo };
		}
		for (const hook of this.hooks.afterModel) {
			const control = (await hook({
				snapshot: this.snapshot(),
				assistantMessage: message,
				finishReason,
			})) as AgentStopControl | undefined;
			this.applyStopControl(control);
		}

		return { message, finishReason };
	}

	private async prepareTurnForModelRequest(
		request: AgentModelRequest,
	): Promise<AgentModelRequest> {
		if (!this.config.prepareTurn) {
			return request;
		}

		const result = await this.config.prepareTurn({
			agentId: this.state.agentId,
			conversationId: this.config.conversationId,
			parentAgentId: this.state.parentAgentId ?? null,
			iteration: this.state.iteration,
			messages: request.messages,
			systemPrompt: request.systemPrompt,
			tools: request.tools,
			model: {
				id: this.config.messageModelInfo?.id,
				provider: this.config.messageModelInfo?.provider,
			},
			signal: request.signal,
			emitStatusNotice: (message, metadata) => {
				void this.emit({
					type: "status-notice",
					snapshot: this.snapshot(),
					message,
					metadata,
				});
			},
		});
		if (!result) {
			return request;
		}

		let next = request;
		if (result.messages) {
			const preparedMessages = cloneMessages(result.messages);
			this.state.messages = preparedMessages;
			next = { ...next, messages: cloneMessages(preparedMessages) };
		}
		if (result.systemPrompt !== undefined) {
			next = { ...next, systemPrompt: result.systemPrompt };
		}
		return next;
	}

	private async updateUsage(usage: Partial<AgentUsage>): Promise<void> {
		this.state.usage = {
			inputTokens: this.state.usage.inputTokens + (usage.inputTokens ?? 0),
			outputTokens: this.state.usage.outputTokens + (usage.outputTokens ?? 0),
			cacheReadTokens:
				this.state.usage.cacheReadTokens + (usage.cacheReadTokens ?? 0),
			cacheWriteTokens:
				this.state.usage.cacheWriteTokens + (usage.cacheWriteTokens ?? 0),
			totalCost: (this.state.usage.totalCost ?? 0) + (usage.totalCost ?? 0),
		};
		await this.emit({
			type: "usage-updated",
			snapshot: this.snapshot(),
			usage: cloneUsage(this.state.usage),
		});
	}

	private async executeToolCalls(
		toolCalls: AgentToolCallPart[],
	): Promise<AgentMessage[]> {
		const prepared: PreparedToolExecution[] = [];
		for (const toolCall of toolCalls) {
			prepared.push(await this.prepareToolExecution(toolCall));
		}

		if (this.config.toolExecution === "parallel") {
			return Promise.all(
				prepared.map((execution) => this.executePreparedTool(execution)),
			);
		}

		const results: AgentMessage[] = [];
		for (const execution of prepared) {
			results.push(await this.executePreparedTool(execution));
		}
		return results;
	}

	private findCompletingToolMessage(
		toolCalls: AgentToolCallPart[],
		toolMessages: AgentMessage[],
	): AgentMessage | undefined {
		for (let index = 0; index < toolCalls.length; index += 1) {
			const toolCall = toolCalls[index];
			if (this.tools.get(toolCall.toolName)?.lifecycle?.completesRun !== true) {
				continue;
			}
			const toolMessage = toolMessages[index];
			const result = toolMessage?.content.find(
				(part): part is Extract<AgentMessagePart, { type: "tool-result" }> =>
					part.type === "tool-result" &&
					part.toolCallId === toolCall.toolCallId,
			);
			if (result && !result.isError) {
				return toolMessage;
			}
		}
		return undefined;
	}

	private async prepareToolExecution(
		toolCall: AgentToolCallPart,
	): Promise<PreparedToolExecution> {
		const tool = this.tools.get(toolCall.toolName);
		let input = toolCall.input;
		let skipReason: string | undefined;
		const metadata =
			toolCall.metadata &&
			typeof toolCall.metadata === "object" &&
			!Array.isArray(toolCall.metadata)
				? (toolCall.metadata as Record<string, unknown>)
				: undefined;

		if (typeof metadata?.inputParseError === "string") {
			skipReason = metadata.inputParseError;
		}

		const toolSource =
			metadata?.toolSource &&
			typeof metadata.toolSource === "object" &&
			!Array.isArray(metadata.toolSource)
				? (metadata.toolSource as Record<string, unknown>)
				: undefined;
		if (toolSource?.executionMode === "provider") {
			const providerId =
				typeof toolSource.providerId === "string"
					? toolSource.providerId
					: "provider";
			skipReason = `Tool execution is disabled for provider ${providerId}`;
		}

		if (tool && !skipReason) {
			for (const hook of this.hooks.beforeTool) {
				const result = (await hook({
					snapshot: this.snapshot(),
					tool,
					toolCall,
					input,
				})) as AgentBeforeToolResult | undefined;
				if (result?.input !== undefined) {
					input = result.input;
				}
				this.applyStopControl(result);
				if (result?.skip) {
					skipReason =
						result.reason ?? `Tool ${tool.name} was blocked by a runtime hook`;
					break;
				}
			}
		}

		if (tool && !skipReason) {
			const policy = resolveToolPolicy(
				toolCall.toolName,
				this.config.toolPolicies,
			);
			if (policy.enabled === false) {
				skipReason = `Tool "${toolCall.toolName}" is disabled by policy`;
			} else if (policy.autoApprove === false) {
				const approval = await this.requestToolApproval(
					toolCall,
					input,
					policy,
				);
				if (!approval.approved) {
					skipReason =
						approval.reason ?? `Tool "${toolCall.toolName}" was not approved`;
				}
			}
		}

		return {
			toolCall: { ...toolCall, input },
			tool,
			input,
			skipReason,
		};
	}

	private async requestToolApproval(
		toolCall: AgentToolCallPart,
		input: unknown,
		policy: ToolPolicy,
	): Promise<ToolApprovalResult> {
		const requestApproval = this.config.requestToolApproval;
		if (!requestApproval) {
			return {
				approved: false,
				reason: `Tool "${toolCall.toolName}" requires approval but no approval callback is configured`,
			};
		}
		try {
			return await requestApproval({
				sessionId:
					this.config.sessionId?.trim() ||
					this.config.conversationId?.trim() ||
					this.state.runId ||
					this.state.agentId,
				agentId: this.state.agentId,
				conversationId:
					this.config.conversationId?.trim() ||
					this.state.runId ||
					this.state.agentId,
				iteration: this.state.iteration,
				toolCallId: toolCall.toolCallId,
				toolName: toolCall.toolName,
				input,
				policy,
			});
		} catch (error) {
			return {
				approved: false,
				reason: `Tool "${toolCall.toolName}" approval request failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
			};
		}
	}

	private async executePreparedTool(
		prepared: PreparedToolExecution,
	): Promise<AgentMessage> {
		const startedAt = new Date();
		await this.emit({
			type: "tool-started",
			snapshot: this.snapshot(),
			iteration: this.state.iteration,
			toolCall: prepared.toolCall,
		});

		let result: AgentToolResult;
		if (prepared.skipReason) {
			result = {
				output: { error: prepared.skipReason },
				isError: true,
			};
		} else if (!prepared.tool) {
			result = {
				output: { error: `Unknown tool: ${prepared.toolCall.toolName}` },
				isError: true,
			};
		} else {
			try {
				const output = await prepared.tool.execute(prepared.input, {
					sessionId: this.config.sessionId,
					agentId: this.state.agentId,
					conversationId: this.config.conversationId,
					runId: this.state.runId ?? createUID("run"),
					iteration: this.state.iteration,
					toolCallId: prepared.toolCall.toolCallId,
					signal: this.abortController?.signal,
					metadata: this.config.toolContextMetadata,
					snapshot: this.snapshot(),
					emitUpdate: (update: unknown) => {
						void this.emit({
							type: "tool-updated",
							snapshot: this.snapshot(),
							iteration: this.state.iteration,
							toolCall: prepared.toolCall,
							update,
						});
					},
				});
				result = { output };
			} catch (error) {
				result = {
					output: {
						error: error instanceof Error ? error.message : String(error),
					},
					isError: true,
				};
			}
		}

		const endedAt = new Date();
		const durationMs = Math.max(0, endedAt.getTime() - startedAt.getTime());

		if (prepared.tool) {
			for (const hook of this.hooks.afterTool) {
				const after = (await hook({
					snapshot: this.snapshot(),
					tool: prepared.tool,
					toolCall: prepared.toolCall,
					input: prepared.input,
					result,
					startedAt,
					endedAt,
					durationMs,
				})) as AgentAfterToolResult | undefined;
				this.applyStopControl(after);
				if (after?.result) {
					result = after.result;
				}
			}
		}

		const message = createMessage("tool", [
			{
				type: "tool-result",
				toolCallId: prepared.toolCall.toolCallId,
				toolName: prepared.toolCall.toolName,
				output: result.output,
				isError: result.isError,
			},
		]);

		await this.emit({
			type: "tool-finished",
			snapshot: this.snapshot(),
			iteration: this.state.iteration,
			toolCall: prepared.toolCall,
			message,
		});

		return message;
	}

	private finishRun(
		status: AgentRunResult["status"],
		assistantMessage?: AgentMessage,
		outputText?: string,
	): AgentRunResult {
		this.state.status = status;
		return {
			agentId: this.state.agentId,
			agentRole: this.state.agentRole,
			runId: this.state.runId ?? createUID("run"),
			status,
			iterations: this.state.iteration,
			outputText:
				outputText ??
				textFromMessage(assistantMessage ?? this.findLastAssistantMessage()),
			messages: cloneMessages(this.state.messages),
			usage: cloneUsage(this.state.usage),
		};
	}

	private findLastAssistantMessage(): AgentMessage | undefined {
		return [...this.state.messages]
			.reverse()
			.find((message) => message.role === "assistant");
	}

	private throwIfAborted(): void {
		if (this.abortController?.signal.aborted) {
			throw this.normalizeAbortError();
		}
	}

	private normalizeAbortError(): Error {
		const reason = this.abortController?.signal.reason;
		if (reason instanceof Error) {
			return reason;
		}
		if (typeof reason === "string") {
			return new Error(reason);
		}
		return new Error(this.state.lastError ?? "Run aborted");
	}

	private async emit(event: AgentRuntimeEvent): Promise<void> {
		const metadata = buildEventMetadata(event);
		switch (event.type) {
			case "run-started":
				// Verbatim clinee calls `logger?.info?.(...)`. sdk-re's
				// `BasicLogger` does not declare `info` (it uses `log`), so
				// we narrow to an optional-info shape at the call site to
				// preserve the clinee runtime contract without mutating
				// shared's `BasicLogger` interface.
				(
					this.config.logger as
						| {
								info?: (msg: string, md?: unknown) => void;
						  }
						| undefined
				)?.info?.("Agent run started", metadata);
				break;
			case "tool-finished":
				(
					this.config.logger as
						| {
								info?: (msg: string, md?: unknown) => void;
						  }
						| undefined
				)?.info?.("Agent tool finished", metadata);
				break;
			case "run-failed":
				this.config.logger?.error?.("Agent run failed", {
					...metadata,
					error: event.error,
				});
				break;
			default:
				this.config.logger?.debug?.("Agent event", metadata);
				break;
		}
		void this.config.telemetry?.capture?.(`agent.${event.type}`, metadata);
		for (const listener of this.listeners) {
			listener(event);
		}
		for (const hook of this.hooks.onEvent) {
			await hook(event);
		}
	}

	private applyStopControl(
		control: AgentStopControl | undefined | undefined,
	): void {
		if (!control?.stop) {
			return;
		}
		if (control.reason) {
			this.state.lastError = control.reason;
		}
		throw new ControlledStopError(control.reason);
	}
}

function buildEventMetadata(event: AgentRuntimeEvent): Record<string, unknown> {
	return {
		agentId: event.snapshot.agentId,
		agentRole: event.snapshot.agentRole,
		runId: event.snapshot.runId,
		status: event.snapshot.status,
		iteration: event.snapshot.iteration,
		eventType: event.type,
	};
}

function mergeToolMetadata(current: unknown, patch: unknown): unknown {
	if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
		return patch;
	}
	if (!current || typeof current !== "object" || Array.isArray(current)) {
		return patch;
	}
	return {
		...(current as Record<string, unknown>),
		...patch,
	};
}

function parseToolInput(assembly: PendingToolAssembly): {
	input: unknown;
	parseError?: string;
	invalidInput: Record<string, unknown>;
	reason?: InvalidToolCall["reason"];
} {
	if (assembly.inputValue !== undefined) {
		return {
			input: assembly.inputValue,
			invalidInput: buildInvalidToolInput(JSON.stringify(assembly.inputValue)),
		};
	}
	if (!assembly.inputText.trim()) {
		return {
			input: {},
			invalidInput: {},
		};
	}
	const parsed = parseToolArguments(assembly.inputText);
	if (parsed.ok) {
		return {
			input: parsed.value,
			invalidInput: buildInvalidToolInput(assembly.inputText),
		};
	}
	return {
		input: {},
		invalidInput: buildInvalidToolInput(assembly.inputText, parsed.error),
		parseError: `Tool call ${assembly.toolName ?? assembly.toolCallId} emitted invalid JSON arguments: ${parsed.error}`,
		reason: "invalid_arguments",
	};
}

function buildInvalidToolInput(
	value: string,
	parseError?: string,
): Record<string, unknown> {
	const trimmed = value.trim();
	if (!trimmed) {
		return {};
	}
	return parseError
		? { rawInputText: value, parseError }
		: { rawInputText: value };
}

function parseToolArguments(
	value: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
	const trimmed = value.trim();
	if (!trimmed) {
		return {
			ok: false,
			error: "Tool call arguments were empty.",
		};
	}

	try {
		return { ok: true, value: JSON.parse(trimmed) };
	} catch {
		// Fall through to a normalized error below.
	}

	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
		return {
			ok: false,
			error: "Tool call arguments must be encoded as a JSON object or array.",
		};
	}

	return {
		ok: false,
		error:
			"Tool call arguments could not be parsed as JSON. Ensure the outer tool payload is valid JSON and escape embedded quotes/newlines inside string fields.",
	};
}

function mergeToolInputText(current: string, incoming: string): string {
	if (!current) {
		return incoming;
	}
	const trimmed = incoming.trimStart();
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		return incoming;
	}
	return current + incoming;
}

export function createAgentRuntime(config: AgentRuntimeConfig): AgentRuntime {
	return new AgentRuntime(config);
}

/**
 * `Agent` is the user-friendly name for `AgentRuntime`. They are the same
 * class; this alias exists so standalone callers can write:
 *
 *     const agent = new Agent({ providerId, modelId, apiKey });
 *     await agent.run("hello");
 *
 * while `@clinebot/core` (which owns model construction) continues to use
 * the `AgentRuntime` name with `{ model, ... }` configs.
 */
export const Agent = AgentRuntime;
export type Agent = AgentRuntime;

export function createAgent(config: AgentRuntimeConfig): AgentRuntime {
	return new AgentRuntime(config);
}
