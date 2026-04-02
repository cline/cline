import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { jsonSchema } from "ai";
import {
	getMissingApiKeyError,
	resolveApiKeyForProvider,
} from "../runtime/auth";
import { toAiSdkMessages } from "../transform/ai-sdk-community-format";
import type {
	ApiStream,
	HandlerModelInfo,
	ModelCapability,
	ModelInfo,
	ProviderConfig,
} from "../types";
import { resolveRoutingProviderId } from "../types";
import type { Message, ToolDefinition } from "../types/messages";
import { retryStream } from "../utils/retry";
import {
	emitAiSdkStream,
	loadAiSdkModule,
	numberOrZero,
} from "./ai-sdk-community";
import { BaseHandler } from "./base";

const DEFAULT_REASONING_EFFORT = "medium" as const;

type OpenAICompatibleProvider = (
	modelId: string,
	settings?: Record<string, unknown>,
) => unknown;

function buildOpenRouterReasoningConfig(options: {
	thinking?: boolean;
	effort?: string;
	budgetTokens?: number;
}) {
	const reasoning: {
		enabled?: boolean;
		effort?: string;
		max_tokens?: number;
	} = {};

	if (typeof options.thinking === "boolean") {
		reasoning.enabled = options.thinking;
	}
	if (options.effort) {
		reasoning.effort = options.effort;
	}
	if (typeof options.budgetTokens === "number" && options.budgetTokens > 0) {
		reasoning.max_tokens = options.budgetTokens;
	}

	return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function toProviderOptionsKey(providerId: string): string {
	return providerId.replace(/-([a-zA-Z0-9])/g, (_, char: string) =>
		char.toUpperCase(),
	);
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
				parameters: jsonSchema(tool.inputSchema),
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
		const capabilities: ModelCapability[] = this.config.capabilities?.includes(
			"prompt-cache",
		)
			? ["prompt-cache"]
			: [];
		return {
			id: this.config.modelId,
			capabilities,
		};
	}

	getMessages(systemPrompt: string, messages: Message[]) {
		return toAiSdkMessages(systemPrompt, messages, {
			assistantToolCallArgKey: "args",
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

		const modelSupportsReasoning =
			modelInfo.capabilities?.includes("reasoning") ?? false;
		const supportsReasoningEffort =
			modelInfo.capabilities?.includes("reasoning-effort") ||
			modelInfo.capabilities?.includes("reasoning") ||
			false;
		const effectiveReasoningEffort =
			this.config.reasoningEffort ??
			(this.config.thinking ? DEFAULT_REASONING_EFFORT : undefined);
		const providerOptionsKey = toProviderOptionsKey(routingProviderId);
		const providerSpecificOptions: Record<string, unknown> = {};
		if (routingProviderId === "openrouter") {
			const reasoning = buildOpenRouterReasoningConfig({
				thinking: this.config.thinking,
				effort: effectiveReasoningEffort,
				budgetTokens: this.config.thinkingBudgetTokens,
			});
			if (reasoning) {
				providerSpecificOptions.reasoning = reasoning;
			}
		} else if (supportsReasoningEffort && effectiveReasoningEffort) {
			providerSpecificOptions.reasoningEffort = effectiveReasoningEffort;
		}
		const requestProviderOptions =
			Object.keys(providerSpecificOptions).length > 0
				? { [providerOptionsKey]: providerSpecificOptions }
				: undefined;

		const stream = ai.streamText({
			model: provider(modelId),
			messages: this.getMessages(systemPrompt, messages),
			tools: toAiSdkTools(tools),
			maxTokens: modelInfo.maxTokens ?? this.config.maxOutputTokens,
			temperature: modelSupportsReasoning
				? undefined
				: (modelInfo.temperature ?? 0),
			providerOptions: requestProviderOptions,
			abortSignal: this.getAbortSignal(),
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
				this.calculateCost(
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
				cacheReadTokens: numberOrZero(usage.cachedInputTokens),
			}),
		});
	}
}

export function createOpenAICompatibleHandler(
	config: ProviderConfig,
): OpenAICompatibleHandler {
	return new OpenAICompatibleHandler(config);
}
