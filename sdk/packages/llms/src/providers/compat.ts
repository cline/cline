import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelRequest,
	GatewayModelDefinition,
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
} from "@cline/shared";
import { estimateRequestInputTokens } from "@cline/shared";
import { nanoid } from "nanoid";
import { BEDROCK_DEFAULT_MODEL_ID } from "../catalog/bedrock";
import { createBedrockProvider } from "./ai-sdk";
import { toAsyncIterable } from "./async";
import { isPositiveFiniteNumber } from "./utils";
import type {
	ApiHandler,
	ApiStream,
	ApiStreamChunk,
	HandlerModelInfo,
	Message,
	ProviderConfig,
	ToolDefinition,
} from "./types";

function toGatewayRequestMessages(
	messages: Message[],
): GatewayStreamRequest["messages"] {
	const toolNames = new Map<string, string>();
	for (const message of messages) {
		if (!Array.isArray(message.content)) continue;
		for (const part of message.content) {
			if (part.type === "tool_use") {
				toolNames.set(part.id, part.name);
				if (part.call_id) toolNames.set(part.call_id, part.name);
			}
		}
	}

	return messages.map((message) => ({
		id: nanoid(),
		role: message.role,
		createdAt: Date.now(),
		content:
			typeof message.content === "string"
				? [{ type: "text", text: message.content }]
				: message.content.flatMap((part): Array<Record<string, unknown>> => {
						switch (part.type) {
							case "text":
								return [{ type: "text" as const, text: part.text }];
							case "thinking":
								return [{
									type: "reasoning" as const,
									text: part.thinking,
									metadata: part.signature
										? { signature: part.signature, details: part.details }
										: undefined,
								}];
							case "tool_use":
								return [{
									type: "tool-call" as const,
									toolCallId: part.call_id ?? part.id,
									toolName: part.name,
									input: part.input,
									metadata: part.signature
										? { thoughtSignature: part.signature }
										: undefined,
								}];
							case "tool_result":
								return [{
									type: "tool-result" as const,
									toolCallId: part.tool_use_id,
									toolName: toolNames.get(part.tool_use_id) ?? "tool",
									output: part.content,
									isError: part.is_error ?? false,
								}];
							case "image":
								return [{
									type: "image" as const,
									image: `data:${part.mediaType};base64,${part.data}`,
									mediaType: part.mediaType,
								}];
							case "file":
								return [{ type: "text" as const, text: part.content }];
							default:
								return [];
						}
					}),
	})) as unknown as GatewayStreamRequest["messages"];
}

function toGatewayTools(
	tools: ToolDefinition[] | undefined,
): GatewayStreamRequest["tools"] {
	return tools?.map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
}

function buildRequest(
	config: ProviderConfig,
	systemPrompt: string,
	messages: Message[],
	tools?: ToolDefinition[],
	signal?: AbortSignal,
): GatewayStreamRequest {
	return {
		providerId: "bedrock",
		modelId: config.modelId,
		systemPrompt,
		messages: toGatewayRequestMessages(messages),
		tools: toGatewayTools(tools),
		maxTokens: config.maxOutputTokens,
		temperature: config.temperature,
		reasoning:
			config.thinking !== undefined ||
			config.reasoningEffort ||
			config.thinkingBudgetTokens !== undefined
				? {
						enabled: config.thinking,
						effort:
							config.reasoningEffort === "xhigh"
								? "high"
								: config.reasoningEffort,
						budgetTokens: config.thinkingBudgetTokens,
					}
				: undefined,
		signal,
	};
}

function toGatewayModelDefinition(
	id: string,
	config: ProviderConfig,
): Omit<GatewayModelDefinition, "providerId"> {
	const info = config.modelInfo ?? config.knownModels?.[id];
	return {
		id,
		name: info?.name ?? id,
		description: info?.description,
		contextWindow: info?.contextWindow,
		maxInputTokens: info?.maxInputTokens ?? config.maxInputTokens,
		maxOutputTokens: info?.maxTokens,
		capabilities: info?.capabilities?.flatMap((capability) => {
			switch (capability) {
				case "tools":
				case "reasoning":
				case "prompt-cache":
				case "images":
					return [capability];
				case "structured_output":
					return ["structured-output" as const];
				default:
					return ["text" as const];
			}
		}),
		metadata: { family: info?.family, pricing: info?.pricing },
	};
}

const DEFAULT_BEDROCK_MAX_OUTPUT_TOKENS = 32_000;
const BEDROCK_OUTPUT_RESERVE_TOKENS = 1_024;

function resolveBedrockRequestMaxTokens(input: {
	requestedMaxTokens?: number;
	model: Pick<GatewayModelDefinition, "contextWindow" | "maxOutputTokens">;
	estimatedInputTokens: number;
	reasoningBudgetTokens?: number;
}): number | undefined {
	const caps: number[] = [];
	if (isPositiveFiniteNumber(input.requestedMaxTokens)) {
		caps.push(Math.floor(input.requestedMaxTokens));
	} else {
		const reasoningFloor = isPositiveFiniteNumber(input.reasoningBudgetTokens)
			? Math.floor(input.reasoningBudgetTokens) +
				BEDROCK_OUTPUT_RESERVE_TOKENS
			: 0;
		if (
			isPositiveFiniteNumber(input.model.maxOutputTokens) ||
			isPositiveFiniteNumber(input.model.contextWindow)
		) {
			caps.push(
				Math.max(DEFAULT_BEDROCK_MAX_OUTPUT_TOKENS, reasoningFloor),
			);
		}
	}
	if (isPositiveFiniteNumber(input.model.maxOutputTokens)) {
		caps.push(Math.floor(input.model.maxOutputTokens));
	}
	if (isPositiveFiniteNumber(input.model.contextWindow)) {
		const remainingContext =
			input.model.contextWindow -
			input.estimatedInputTokens -
			BEDROCK_OUTPUT_RESERVE_TOKENS;
		if (remainingContext <= 0) return undefined;
		caps.push(Math.floor(remainingContext));
	}
	return caps.length === 0
		? undefined
		: Math.max(1, Math.floor(Math.min(...caps)));
}

function toBedrockRequest(
	config: ProviderConfig,
	request: AgentModelRequest,
): GatewayStreamRequest {
	const requestedReasoning = request.options?.reasoning as
		| {
				enabled?: boolean;
				effort?: "low" | "medium" | "high";
				budgetTokens?: number;
		  }
		| undefined;
	const legacyEffort =
		request.options?.reasoningEffort === "low" ||
		request.options?.reasoningEffort === "medium" ||
		request.options?.reasoningEffort === "high"
			? request.options.reasoningEffort
			: undefined;
	const legacyReasoning:
		| {
				enabled?: boolean;
				effort?: "low" | "medium" | "high";
				budgetTokens?: number;
		  }
		| undefined =
		typeof request.options?.thinking === "boolean" ||
		legacyEffort !== undefined ||
		typeof request.options?.thinkingBudgetTokens === "number"
			? {
					enabled:
						typeof request.options?.thinking === "boolean"
							? request.options.thinking
							: undefined,
					effort: legacyEffort,
					budgetTokens:
						typeof request.options?.thinkingBudgetTokens === "number"
							? request.options.thinkingBudgetTokens
							: undefined,
				}
			: undefined;
	return {
		providerId: "bedrock",
		modelId: config.modelId,
		systemPrompt: request.systemPrompt,
		messages: request.messages as readonly AgentMessage[],
		tools: request.tools,
		temperature:
			(request.options?.temperature as number | undefined) ??
			config.temperature,
		maxTokens:
			(request.options?.maxTokens as number | undefined) ??
			config.maxOutputTokens,
		reasoning: requestedReasoning ?? legacyReasoning,
		metadata: request.options?.metadata as
			| Record<string, unknown>
			| undefined,
		signal: request.signal,
	};
}

function createModel(config: ProviderConfig): AgentModel {
	const model = {
		...toGatewayModelDefinition(config.modelId, config),
		providerId: "bedrock",
	};
	const provider = {
		id: "bedrock",
		name: "AWS Bedrock",
		description: "Amazon Bedrock managed foundation models",
		defaultModelId: config.modelId || BEDROCK_DEFAULT_MODEL_ID,
		models: [model],
		capabilities: ["tools", "reasoning", "prompt-cache", "streaming"] as const,
		env: ["node"] as const,
	};
	const providerConfig: GatewayResolvedProviderConfig = {
		providerId: "bedrock",
		options: {
			connection: config.connection,
			workspaceRoot: config.workspaceRoot,
		},
	};
	const context: GatewayProviderContext = {
		provider,
		model,
		config: providerConfig,
		logger: config.logger ?? config.extensionContext?.logger,
	};
	return {
		async stream(request: AgentModelRequest) {
			const bedrockRequest = toBedrockRequest(config, request);
			const maxTokens = resolveBedrockRequestMaxTokens({
				requestedMaxTokens: bedrockRequest.maxTokens,
				model,
				estimatedInputTokens: estimateRequestInputTokens(bedrockRequest),
				reasoningBudgetTokens: bedrockRequest.reasoning?.budgetTokens,
			});
			const bedrock = await createBedrockProvider(providerConfig);
			return toAsyncIterable(
				await bedrock.stream(
					{
						...bedrockRequest,
						maxTokens,
						defaultedMaxTokens:
							maxTokens !== undefined &&
							!isPositiveFiniteNumber(bedrockRequest.maxTokens),
					},
					{
						...context,
						signal: request.signal,
					},
				),
			);
		},
	};
}

function toApiStreamChunk(id: string, event: AgentModelEvent): ApiStreamChunk {
	switch (event.type) {
		case "text-delta":
			return { type: "text", id, text: event.text };
		case "reasoning-delta": {
			const metadata = event.metadata as Record<string, unknown> | undefined;
			return {
				type: "reasoning",
				id,
				reasoning: event.text,
				signature:
					typeof metadata?.signature === "string"
						? metadata.signature
						: undefined,
				details: metadata?.details,
			};
		}
		case "tool-call-delta":
			return {
				type: "tool_calls",
				id,
				tool_call: {
					call_id: event.toolCallId,
					function: {
						id: event.toolCallId,
						name: event.toolName,
						arguments:
							typeof event.inputText === "string" ||
							event.input === undefined
								? event.inputText
								: (event.input as Record<string, unknown>),
					},
				},
			};
		case "usage":
			return {
				type: "usage",
				id,
				inputTokens: event.usage.inputTokens ?? 0,
				outputTokens: event.usage.outputTokens ?? 0,
				cacheReadTokens: event.usage.cacheReadTokens,
				cacheWriteTokens: event.usage.cacheWriteTokens,
				thoughtsTokenCount: event.usage.reasoningTokenCount,
				totalCost: event.usage.totalCost,
			};
		case "finish":
			return {
				type: "done",
				id,
				success: event.reason !== "error",
				error: event.error,
				incompleteReason:
					event.reason === "max-tokens" ? "max_tokens" : undefined,
			};
	}
}

class BedrockApiHandler implements ApiHandler {
	private abortSignal: AbortSignal | undefined;

	constructor(private readonly config: ProviderConfig) {
		this.abortSignal = config.abortSignal;
	}

	getMessages(systemPrompt: string, messages: Message[]): unknown {
		return buildRequest(this.config, systemPrompt, messages, undefined, this.abortSignal);
	}

	createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		const model = createModel(this.config);
		const request = buildRequest(
			this.config,
			systemPrompt,
			messages,
			tools,
			this.abortSignal,
		);
		const id = `bedrock_${nanoid(10)}`;
		const stream = (async function* () {
			for await (const event of await model.stream({
				systemPrompt: request.systemPrompt,
				messages: request.messages,
				tools: request.tools ?? [],
				options: {
					maxTokens: request.maxTokens,
					temperature: request.temperature,
					reasoning: request.reasoning,
				},
				signal: request.signal,
			})) {
				yield toApiStreamChunk(id, event);
			}
		})() as ApiStream;
		stream.id = id;
		return stream;
	}

	getModel(): HandlerModelInfo {
		const info = this.config.modelInfo ??
			this.config.knownModels?.[this.config.modelId] ?? {
				id: this.config.modelId,
				name: this.config.modelId,
				capabilities: ["streaming" as const],
			};
		return { id: this.config.modelId, info };
	}

	abort(): void {}

	setAbortSignal(signal: AbortSignal | undefined): void {
		this.abortSignal = signal;
	}
}

export function createBedrockClient(config: ProviderConfig): ApiHandler {
	return new BedrockApiHandler(config);
}

export function createBedrockAgentModel(config: ProviderConfig): AgentModel {
	return createModel(config);
}
