import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
	resolveEffectiveReasoningEffort,
	resolveReasoningBudgetFromRatio,
} from "@clinebot/shared";
import z from "zod";
import {
	getMissingApiKeyError,
	resolveApiKeyForProvider,
} from "../runtime/auth";
import {
	debugLangfuse,
	ensureLangfuseTelemetry,
} from "../runtime/langfuse-telemetry";
import { toAiSdkMessages } from "../transform/ai-sdk-community-format";
import type { ApiStream, HandlerModelInfo, ModelInfo } from "../types";
import { resolveRoutingProviderId } from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import { retryStream } from "../utils/retry";
import {
	emitAiSdkStream,
	loadAiSdkModule,
	numberOrZero,
} from "./shared/ai-sdk-stream";
import { BaseHandler } from "./shared/base-handler";

type OpenAICompatibleProvider = (
	modelId: string,
	settings?: Record<string, unknown>,
) => unknown;

function isAnthropicModelId(modelId: string): boolean {
	return modelId.toLowerCase().startsWith("anthropic/");
}

function resolveAnthropicOpenRouterReasoningBudget(options: {
	modelId?: string;
	effort?: string;
	maxTokens?: number;
	explicitBudgetTokens?: number;
}) {
	if (
		typeof options.explicitBudgetTokens === "number" &&
		options.explicitBudgetTokens > 0
	) {
		return options.explicitBudgetTokens;
	}

	if (
		!options.modelId ||
		!isAnthropicModelId(options.modelId) ||
		!options.effort ||
		options.effort === "none" ||
		typeof options.maxTokens !== "number" ||
		options.maxTokens <= 1024
	) {
		return undefined;
	}

	const maxBudget = Math.min(options.maxTokens - 1, 128000);
	return resolveReasoningBudgetFromRatio({
		effort: options.effort,
		maxBudget,
		scaleTokens: options.maxTokens,
		minimumBudget: 1024,
	});
}

function buildGatewayReasoningConfig(options: {
	modelId?: string;
	thinking?: boolean;
	effort?: string;
	budgetTokens?: number;
	maxTokens?: number;
}) {
	const anthropicModel =
		!!options.modelId && isAnthropicModelId(options.modelId);
	const reasoning: {
		enabled?: boolean;
		effort?: string;
		max_tokens?: number;
	} = {};

	if (options.thinking === true) {
		reasoning.enabled = true;
	}
	const budgetTokens = resolveAnthropicOpenRouterReasoningBudget({
		modelId: options.modelId,
		effort: options.effort,
		maxTokens: options.maxTokens,
		explicitBudgetTokens: options.budgetTokens,
	});
	if (typeof budgetTokens === "number" && budgetTokens > 0) {
		reasoning.max_tokens = budgetTokens;
	} else if (options.effort) {
		reasoning.effort = options.effort;
	} else if (anthropicModel && options.budgetTokens === 0) {
		reasoning.max_tokens = 0;
	}

	return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function toProviderOptionsKey(providerId: string): string {
	return providerId.replace(/-([a-zA-Z0-9])/g, (_, char: string) =>
		char.toUpperCase(),
	);
}

function createPromptCacheProviderOptions(providerId: string) {
	return {
		[providerId]: {
			cache_control: { type: "ephemeral" },
		},
	};
}

function applyPromptCacheToLastTextPart(
	message: Record<string, unknown> | undefined,
	providerId: string,
): void {
	if (!message) {
		return;
	}

	const content = message.content;
	if (typeof content === "string") {
		message.content = [
			{
				type: "text",
				text: content,
				providerOptions: createPromptCacheProviderOptions(providerId),
			},
		];
		return;
	}

	if (!Array.isArray(content)) {
		return;
	}

	for (let i = content.length - 1; i >= 0; i--) {
		const part = content[i];
		if (
			part &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text"
		) {
			content[i] = {
				...(part as Record<string, unknown>),
				providerOptions: createPromptCacheProviderOptions(providerId),
			};
			return;
		}
	}
}

function buildCachedAiSdkMessages(
	systemPrompt: string,
	messages: Message[],
	routingProviderId: string,
) {
	const aiMessages = toAiSdkMessages(systemPrompt, messages, {
		assistantToolCallArgKey: "input",
	}) as Array<Record<string, unknown>>;

	for (let i = aiMessages.length - 1; i >= 0; i--) {
		if (aiMessages[i]?.role === "user") {
			applyPromptCacheToLastTextPart(aiMessages[i], routingProviderId);
			break;
		}
	}

	return aiMessages;
}

function resolveCacheUsageMetrics(usage: Record<string, unknown>): Pick<
	{
		cacheReadTokens: number;
		cacheWriteTokens: number;
	},
	"cacheReadTokens" | "cacheWriteTokens"
> {
	const usageWithCache = usage as typeof usage & {
		cachedInputTokens?: unknown;
		cacheWriteTokens?: unknown;
		prompt_tokens_details?: {
			cached_tokens?: unknown;
			cache_write_tokens?: unknown;
		};
		cache_creation_input_tokens?: unknown;
		cache_read_input_tokens?: unknown;
	};

	return {
		cacheReadTokens: numberOrZero(
			usageWithCache.cachedInputTokens ??
				usageWithCache.prompt_tokens_details?.cached_tokens ??
				usageWithCache.cache_read_input_tokens,
		),
		cacheWriteTokens: numberOrZero(
			usageWithCache.cacheWriteTokens ??
				usageWithCache.prompt_tokens_details?.cache_write_tokens ??
				usageWithCache.cache_creation_input_tokens,
		),
	};
}

function toAiSdkTools(
	tools: ToolDefinition[] | undefined,
): Record<string, unknown> | undefined {
	if (!tools || tools.length === 0) {
		return undefined;
	}

	return Object.fromEntries(
		tools.map((tool) => [
			tool.name,
			{
				description: tool.description,
				inputSchema: z.fromJSONSchema(tool.inputSchema),
			},
		]),
	);
}

/**
 * OpenAI-compatible handler powered by @ai-sdk/openai-compatible.
 */
export class OpenAICompatibleHandler extends BaseHandler {
	readonly type = "openai-compatible";
	private provider: OpenAICompatibleProvider | undefined;

	private ensureProvider(): OpenAICompatibleProvider {
		if (this.provider) {
			return this.provider;
		}

		const routingProviderId = resolveRoutingProviderId(this.config);
		const baseURL = this.config.baseUrl;
		if (!baseURL) {
			throw new Error("Base URL is required. Set baseUrl in config.");
		}

		const apiKey = resolveApiKeyForProvider(
			routingProviderId,
			this.config.apiKey,
		);
		if (!apiKey) {
			throw new Error(getMissingApiKeyError(routingProviderId));
		}

		this.provider = createOpenAICompatible({
			name: routingProviderId,
			apiKey,
			baseURL,
			headers: this.getRequestHeaders(),
			includeUsage: true,
		}) as OpenAICompatibleProvider;

		return this.provider;
	}

	getModel(): HandlerModelInfo {
		const modelId = this.config.modelId;
		if (!modelId) {
			throw new Error("Model ID is required. Set modelId in config.");
		}

		const modelInfo =
			this.config.modelInfo ??
			this.config.knownModels?.[modelId] ??
			this.getDefaultModelInfo();

		return { id: modelId, info: { ...modelInfo, id: modelId } };
	}

	protected getDefaultModelInfo(): ModelInfo {
		return {
			id: this.config.modelId,
			capabilities: this.resolveModelCapabilities(),
		};
	}

	getMessages(systemPrompt: string, messages: Message[]) {
		return toAiSdkMessages(systemPrompt, messages, {
			assistantToolCallArgKey: "input",
		});
	}

	async *createMessage(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		yield* retryStream(() =>
			this.createMessageInternal(systemPrompt, messages, tools),
		);
	}

	private async *createMessageInternal(
		systemPrompt: string,
		messages: Message[],
		tools?: ToolDefinition[],
	): ApiStream {
		const ai = await loadAiSdkModule();
		const provider = this.ensureProvider();
		const { id: modelId, info: modelInfo } = this.getModel();
		const responseId = this.createResponseId();
		const routingProviderId = resolveRoutingProviderId(this.config);

		const modelSupportsReasoning = this.hasResolvedCapability(
			"reasoning",
			modelInfo,
		);
		const effectiveReasoningEffort = resolveEffectiveReasoningEffort(
			this.config.reasoningEffort,
			this.config.thinking,
		);
		const wantsReasoningConfig =
			this.config.thinking === true ||
			typeof effectiveReasoningEffort === "string" ||
			(typeof this.config.thinkingBudgetTokens === "number" &&
				this.config.thinkingBudgetTokens > 0);
		const maxTokens = modelInfo.maxTokens ?? this.config.maxOutputTokens;
		const providerOptionsKey = toProviderOptionsKey(routingProviderId);
		const providerSpecificOptions: Record<string, unknown> = {};
		if (wantsReasoningConfig) {
			const reasoning = buildGatewayReasoningConfig({
				modelId,
				thinking: this.config.thinking,
				effort: effectiveReasoningEffort,
				budgetTokens: this.config.thinkingBudgetTokens,
				maxTokens,
			});
			if (reasoning) {
				providerSpecificOptions.reasoning = reasoning;
			}
		}
		const requestProviderOptions =
			Object.keys(providerSpecificOptions).length > 0
				? { [providerOptionsKey]: providerSpecificOptions }
				: undefined;
		const langfuseTelemetryReady =
			await ensureLangfuseTelemetry(routingProviderId);
		debugLangfuse(`ready langfuse=${String(langfuseTelemetryReady)}`);

		const supportsPromptCache = this.supportsPromptCache(modelInfo);
		const aiMessages =
			supportsPromptCache && isAnthropicModelId(modelId)
				? buildCachedAiSdkMessages(systemPrompt, messages, routingProviderId)
				: this.getMessages(systemPrompt, messages);

		const stream = ai.streamText({
			model: provider(modelId),
			messages: aiMessages,
			tools: toAiSdkTools(tools),
			maxTokens,
			temperature: modelSupportsReasoning
				? undefined
				: (modelInfo.temperature ?? 0),
			providerOptions: requestProviderOptions,
			abortSignal: this.getAbortSignal(),
			experimental_telemetry: {
				isEnabled: true,
			},
		});

		yield* emitAiSdkStream(stream, {
			responseId,
			errorMessage: "OpenAI-compatible stream failed",
			calculateCost: (
				inputTokens,
				outputTokens,
				cacheReadTokens,
				cacheWriteTokens,
			) =>
				this.calculateCostFromInclusiveInput(
					inputTokens,
					outputTokens,
					cacheReadTokens,
					cacheWriteTokens,
				),
			reasoningTypes: ["reasoning-delta", "reasoning"],
			enableToolCalls: true,
			toolCallArgsOrder: ["args", "input"],
			toolCallFunctionIncludeId: true,
			resolveUsageMetrics: (usage) => ({
				inputTokens: numberOrZero(usage.inputTokens),
				outputTokens: numberOrZero(usage.outputTokens),
				thoughtsTokenCount: numberOrZero(
					usage.reasoningTokens ?? usage.thoughtsTokenCount,
				),
				...resolveCacheUsageMetrics(usage as Record<string, unknown>),
			}),
		});
	}
}
