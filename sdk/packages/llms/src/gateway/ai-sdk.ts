import type {
	AgentMessage,
	AgentModelEvent,
	AgentModelFinishReason,
	GatewayProviderContext,
	GatewayProviderFactory,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
} from "@clinebot/shared";
import {
	type AiSdkFormatterMessage,
	type AiSdkFormatterPart,
	formatMessagesForAiSdk,
} from "@clinebot/shared";
import { streamText } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { ProviderFactoryResult } from "./providers/types";

interface AiSdkStreamPart {
	type?: string;
	[key: string]: unknown;
}

interface AiSdkStreamResult {
	fullStream?: AsyncIterable<AiSdkStreamPart>;
	textStream?: AsyncIterable<string>;
	text?: Promise<string> | string;
	usage?: Promise<Record<string, unknown>>;
}

interface NormalizedUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost?: number;
}

type ProviderModuleKind =
	| "openai"
	| "openai-compatible"
	| "anthropic"
	| "google"
	| "vertex"
	| "bedrock"
	| "mistral"
	| "claude-code"
	| "openai-codex"
	| "opencode"
	| "dify";

function resolveModelFamily(
	context: GatewayProviderContext,
): string | undefined {
	const family = context.model.metadata?.family;
	return typeof family === "string" ? family : undefined;
}

function isAnthropicModel(options: {
	modelId?: string;
	family?: string;
}): boolean {
	if (typeof options.family === "string") {
		return options.family.toLowerCase().includes("claude");
	}

	return isAnthropicModelId(options.modelId);
}

function isAnthropicModelId(modelId: string | undefined): boolean {
	if (!modelId) {
		return false;
	}

	const normalized = modelId.toLowerCase();
	return (
		normalized.startsWith("anthropic/") ||
		normalized.startsWith("claude-") ||
		normalized.includes("/claude-")
	);
}

function toProviderOptionsKey(providerId: string): string {
	return providerId.replace(/-([a-z0-9])/gi, (_match, char: string) =>
		char.toUpperCase(),
	);
}

function createEphemeralCacheControl() {
	return {
		cache_control: { type: "ephemeral" as const },
	};
}

function createPromptCacheProviderOptions(
	providerId: string,
	includeAnthropic: boolean,
) {
	const providerOptions: Record<string, unknown> = {
		openaiCompatible: createEphemeralCacheControl(),
		[providerId]: createEphemeralCacheControl(),
	};

	const providerOptionsKey = toProviderOptionsKey(providerId);
	if (providerOptionsKey !== providerId) {
		providerOptions[providerOptionsKey] = createEphemeralCacheControl();
	}
	if (includeAnthropic) {
		providerOptions.anthropic = createEphemeralCacheControl();
	}

	return providerOptions;
}

function applyPromptCacheToLastTextPart(
	message: Record<string, unknown> | undefined,
	providerId: string,
	includeAnthropic: boolean,
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
				providerOptions: createPromptCacheProviderOptions(
					providerId,
					includeAnthropic,
				),
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
				providerOptions: createPromptCacheProviderOptions(
					providerId,
					includeAnthropic,
				),
			};
			return;
		}
	}
}

function buildCachedAiSdkMessages(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	systemPrompt?: string,
) {
	const aiMessages = toAiSdkMessages(request.messages, systemPrompt) as Array<
		Record<string, unknown>
	>;
	const includeAnthropic = isAnthropicModel({
		modelId: request.modelId,
		family: resolveModelFamily(context),
	});

	for (let i = aiMessages.length - 1; i >= 0; i--) {
		if (aiMessages[i]?.role === "user") {
			applyPromptCacheToLastTextPart(
				aiMessages[i],
				request.providerId,
				includeAnthropic,
			);
			break;
		}
	}

	return aiMessages;
}

function shouldUseAnthropicPromptCache(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): boolean {
	return isAnthropicModel({
		modelId: request.modelId,
		family: resolveModelFamily(context),
	});
}

function resolveAnthropicCompatibleReasoningBudget(options: {
	modelId?: string;
	family?: string;
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
		(!options.modelId && !options.family) ||
		!isAnthropicModel({
			modelId: options.modelId,
			family: options.family,
		}) ||
		!options.effort ||
		typeof options.maxTokens !== "number" ||
		options.maxTokens <= 1024
	) {
		return undefined;
	}

	const ratios: Record<string, number> = {
		low: 0.2,
		medium: 0.5,
		high: 0.8,
	};
	const ratio = ratios[options.effort];
	if (!ratio) {
		return undefined;
	}

	const maxBudget = Math.min(options.maxTokens - 1, 128000);
	return Math.max(1024, Math.floor(maxBudget * ratio));
}

function buildAnthropicCompatibleReasoningOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
) {
	if (
		!isAnthropicModel({
			modelId: request.modelId,
			family: resolveModelFamily(context),
		}) ||
		(!request.reasoning?.enabled &&
			!request.reasoning?.effort &&
			typeof request.reasoning?.budgetTokens !== "number")
	) {
		return undefined;
	}

	const budgetTokens = resolveAnthropicCompatibleReasoningBudget({
		modelId: request.modelId,
		family: resolveModelFamily(context),
		effort: request.reasoning?.effort,
		maxTokens: request.maxTokens,
		explicitBudgetTokens: request.reasoning?.budgetTokens,
	});
	const reasoning: Record<string, unknown> = {};

	if (request.reasoning?.enabled === true) {
		reasoning.enabled = true;
	}
	if (typeof budgetTokens === "number" && budgetTokens >= 0) {
		reasoning.max_tokens = budgetTokens;
	} else if (request.reasoning?.effort) {
		reasoning.effort = request.reasoning.effort;
	} else if (request.reasoning?.budgetTokens === 0) {
		reasoning.max_tokens = 0;
	}

	return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

function buildGatewayReasoningOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
) {
	if (
		!request.reasoning?.enabled &&
		!request.reasoning?.effort &&
		typeof request.reasoning?.budgetTokens !== "number"
	) {
		return undefined;
	}

	const budgetTokens = isAnthropicModel({
		modelId: request.modelId,
		family: resolveModelFamily(context),
	})
		? resolveAnthropicCompatibleReasoningBudget({
				modelId: request.modelId,
				family: resolveModelFamily(context),
				effort: request.reasoning?.effort,
				maxTokens: request.maxTokens,
				explicitBudgetTokens: request.reasoning?.budgetTokens,
			})
		: request.reasoning?.budgetTokens;

	const reasoning: Record<string, unknown> = {
		...(request.reasoning?.enabled === true || request.reasoning?.effort
			? { enabled: true }
			: {}),
		...(request.reasoning?.effort ? { effort: request.reasoning.effort } : {}),
	};

	if (typeof budgetTokens === "number" && budgetTokens >= 0) {
		reasoning.max_tokens = budgetTokens;
	}

	return Object.keys(reasoning).length > 0 ? reasoning : undefined;
}

async function ensureGatewayLangfuseTelemetry(
	providerId: string,
): Promise<boolean> {
	try {
		const runtime = await import("../runtime/langfuse-telemetry");
		return runtime.ensureLangfuseTelemetry(providerId);
	} catch {
		return false;
	}
}

function toAiSdkMessages(
	messages: readonly AgentMessage[],
	systemPrompt?: string,
) {
	const normalizedMessages: AiSdkFormatterMessage[] = [];

	for (const message of messages) {
		const content: AiSdkFormatterPart[] = [];
		for (const part of message.content) {
			if (part.type === "text") {
				content.push({ type: "text", text: part.text });
				continue;
			}

			if (part.type === "reasoning") {
				const signature = part.metadata?.signature;
				const redactedData = part.metadata?.redactedData;
				content.push({
					type: "reasoning",
					text: part.text,
					...(typeof signature === "string" || typeof redactedData === "string"
						? {
								providerOptions: {
									anthropic: {
										...(typeof signature === "string" ? { signature } : {}),
										...(typeof redactedData === "string"
											? { redactedData }
											: {}),
									},
								},
							}
						: {}),
				});
				continue;
			}

			if (part.type === "tool-call") {
				const thoughtSignature =
					part.metadata?.thoughtSignature ?? part.metadata?.thought_signature;
				content.push({
					type: "tool-call",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					input: part.input,
					...(typeof thoughtSignature === "string"
						? {
								providerOptions: {
									google: { thoughtSignature },
								},
							}
						: {}),
				});
				continue;
			}

			if (part.type === "tool-result") {
				content.push({
					type: "tool-result",
					toolCallId: part.toolCallId,
					toolName: part.toolName,
					output: part.output,
					isError: part.isError ?? false,
				});
			}
		}

		if (content.length > 0) {
			normalizedMessages.push({ role: message.role, content });
		} else if (message.role === "user" || message.role === "assistant") {
			normalizedMessages.push({ role: message.role, content: "" });
		}
	}

	return formatMessagesForAiSdk(systemPrompt, normalizedMessages, {
		assistantToolCallArgKey: "input",
	});
}

function toAiSdkTools(
	request: GatewayStreamRequest,
): Record<string, unknown> | undefined {
	if (!request.tools?.length) {
		return undefined;
	}

	return Object.fromEntries(
		request.tools.map((definition) => [
			definition.name,
			{
				description: definition.description,
				inputSchema: z.fromJSONSchema(definition.inputSchema) as never,
			} as unknown,
		]),
	);
}

function toAiSdkProviderOptions(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Record<string, unknown> | undefined {
	const providerOptionsKey = toProviderOptionsKey(request.providerId);
	const isAnthropicCompatibleModel = isAnthropicModel({
		modelId: request.modelId,
		family: resolveModelFamily(context),
	});
	const anthropicCompatibleReasoning = buildAnthropicCompatibleReasoningOptions(
		request,
		context,
	);
	const gatewayReasoning = buildGatewayReasoningOptions(request, context);
	const wantsAnthropicThinking =
		request.reasoning?.enabled === true ||
		typeof request.reasoning?.effort === "string";
	const anthropicOptions = {
		...(wantsAnthropicThinking ? { thinking: { type: "adaptive" } } : {}),
		...(request.reasoning?.effort ? { effort: request.reasoning.effort } : {}),
		...createEphemeralCacheControl(),
	};
	const compatibleOptions = {
		...(request.reasoning?.enabled === true
			? { thinking: { type: "adaptive" } }
			: {}),
		...(request.reasoning?.effort ? { effort: request.reasoning.effort } : {}),
		...(request.reasoning?.effort
			? { reasoningEffort: request.reasoning.effort }
			: {}),
		...(request.reasoning?.effort && !isAnthropicCompatibleModel
			? { reasoningSummary: "auto" }
			: {}),
		...(anthropicCompatibleReasoning
			? { reasoning: anthropicCompatibleReasoning }
			: {}),
		...createEphemeralCacheControl(),
	};
	const geminiCompatibleOptions = request.reasoning?.effort
		? {
				thinkingConfig: {
					thinkingLevel: request.reasoning.effort,
					includeThoughts: true,
				},
			}
		: undefined;

	const providerOptions: Record<string, unknown> = {
		anthropic: anthropicOptions,
		openaiCompatible: compatibleOptions,
	};
	if (request.providerId !== "anthropic") {
		providerOptions[request.providerId] = {
			...compatibleOptions,
			...(request.providerId === "cline" && gatewayReasoning
				? { reasoning: gatewayReasoning }
				: {}),
		};
	}
	if (request.providerId === "google" || request.providerId === "gemini") {
		providerOptions.google = geminiCompatibleOptions;
	}
	if (
		providerOptionsKey !== request.providerId &&
		providerOptionsKey !== "anthropic"
	) {
		providerOptions[providerOptionsKey] = compatibleOptions;
	}
	return providerOptions;
}

function mapFinishReason(
	value: unknown,
	sawToolCalls: boolean,
): AgentModelFinishReason {
	if (value === "tool-calls" || value === "tool_calls" || sawToolCalls) {
		return "tool-calls";
	}
	if (value === "length" || value === "max_tokens") {
		return "max-tokens";
	}
	if (value === "error") {
		return "error";
	}
	return "stop";
}

function getUsageValue(
	usage: Record<string, unknown>,
	...keys: string[]
): number {
	for (const key of keys) {
		const value = usage[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value;
		}
		if (
			typeof value === "string" &&
			value.trim().length > 0 &&
			Number.isFinite(Number(value))
		) {
			return Number(value);
		}
	}
	return 0;
}

function hasUsageValue(
	usage: Record<string, unknown>,
	...keys: string[]
): boolean {
	return keys.some((key) => getNumericValue(usage[key]) !== undefined);
}

function getNumericValue(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (
		typeof value === "string" &&
		value.trim().length > 0 &&
		Number.isFinite(Number(value))
	) {
		return Number(value);
	}
	return undefined;
}

function getNestedUsageValue(
	usage: Record<string, unknown>,
	...path: string[]
): number {
	let current: unknown = usage;
	for (const key of path) {
		if (!current || typeof current !== "object") {
			return 0;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return typeof current === "number" && Number.isFinite(current) ? current : 0;
}

function extractProviderNestedUsage(
	value: unknown,
): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object") {
		return undefined;
	}

	const providerMetadata = value as Record<string, unknown>;
	for (const nestedValue of Object.values(providerMetadata)) {
		if (!nestedValue || typeof nestedValue !== "object") {
			continue;
		}

		const nestedMetadata = nestedValue as Record<string, unknown>;
		if (nestedMetadata.usage && typeof nestedMetadata.usage === "object") {
			return nestedMetadata.usage as Record<string, unknown>;
		}
	}

	return undefined;
}

function calculateUsageCostFromPricing(
	usage: Omit<NormalizedUsage, "totalCost">,
	pricingValue: unknown,
): number | undefined {
	if (!pricingValue || typeof pricingValue !== "object") {
		return undefined;
	}

	const pricing = pricingValue as Record<string, unknown>;
	const inputPrice = getNumericValue(pricing.input);
	const outputPrice = getNumericValue(pricing.output);

	if (inputPrice === undefined || outputPrice === undefined) {
		return undefined;
	}

	const cacheReadPrice = getNumericValue(pricing.cacheRead) ?? 0;
	const cacheWritePrice =
		getNumericValue(pricing.cacheWrite) ?? inputPrice * 1.25;
	const billableInputTokens = Math.max(
		0,
		usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens,
	);

	return (
		(billableInputTokens / 1_000_000) * inputPrice +
		(usage.outputTokens / 1_000_000) * outputPrice +
		(usage.cacheReadTokens / 1_000_000) * cacheReadPrice +
		(usage.cacheWriteTokens / 1_000_000) * cacheWritePrice
	);
}

function normalizeUsage(
	usageValue: unknown,
	providerMetadata?: unknown,
	pricingValue?: unknown,
): NormalizedUsage {
	const usage =
		usageValue && typeof usageValue === "object"
			? (usageValue as Record<string, unknown>)
			: {};
	const providerUsage = extractProviderNestedUsage(providerMetadata);
	const providerMetadataRecord =
		providerMetadata && typeof providerMetadata === "object"
			? (providerMetadata as Record<string, unknown>)
			: {};
	const gatewayMetadata =
		providerMetadataRecord.gateway &&
		typeof providerMetadataRecord.gateway === "object"
			? (providerMetadataRecord.gateway as Record<string, unknown>)
			: {};
	const upstreamInferenceCost = getNumericValue(
		(usage.cost_details as Record<string, unknown> | undefined)
			?.upstream_inference_cost,
	);
	const hasExplicitCost =
		hasUsageValue(usage, "market_cost", "marketCost", "cost") ||
		hasUsageValue(gatewayMetadata, "marketCost", "cost") ||
		upstreamInferenceCost !== undefined ||
		hasUsageValue(usage, "upstream_inference_cost");
	const totalCost =
		getNumericValue(usage.market_cost) ??
		getNumericValue(usage.marketCost) ??
		getNumericValue(gatewayMetadata.marketCost) ??
		getNumericValue(usage.cost) ??
		getNumericValue(gatewayMetadata.cost) ??
		upstreamInferenceCost ??
		getNumericValue(usage.upstream_inference_cost);
	const normalizedUsage = {
		inputTokens: getUsageValue(
			usage,
			"inputTokens",
			"input_tokens",
			"prompt_tokens",
		),
		outputTokens: getUsageValue(
			usage,
			"outputTokens",
			"output_tokens",
			"completion_tokens",
		),
		cacheReadTokens:
			getNestedUsageValue(usage, "inputTokenDetails", "cacheReadTokens") ||
			getUsageValue(
				usage,
				"cachedInputTokens",
				"cacheReadTokens",
				"cache_read_tokens",
				"cache_read_input_tokens",
			) ||
			getNestedUsageValue(usage, "prompt_tokens_details", "cached_tokens") ||
			getUsageValue(
				providerUsage ?? {},
				"cachedInputTokens",
				"cacheReadTokens",
				"cache_read_tokens",
				"cache_read_input_tokens",
			),
		cacheWriteTokens:
			getUsageValue(
				usage,
				"cacheWriteTokens",
				"cache_write_tokens",
				"cache_creation_input_tokens",
			) ||
			getUsageValue(
				providerUsage ?? {},
				"cacheWriteTokens",
				"cache_write_tokens",
				"cache_creation_input_tokens",
			),
	};
	const resolvedTotalCost =
		totalCost !== undefined
			? totalCost
			: hasExplicitCost
				? undefined
				: calculateUsageCostFromPricing(normalizedUsage, pricingValue);

	return {
		...normalizedUsage,
		...(typeof resolvedTotalCost === "number"
			? { totalCost: resolvedTotalCost }
			: {}),
	};
}

function extractErrorMessage(error: unknown): string {
	if (
		error &&
		typeof error === "object" &&
		"statusCode" in error &&
		"responseBody" in error
	) {
		const apiError = error as {
			statusCode?: unknown;
			responseBody?: unknown;
			message?: unknown;
		};
		if (typeof apiError.responseBody === "string") {
			try {
				const parsed = JSON.parse(apiError.responseBody) as {
					error?: { message?: string } | string;
				};
				if (typeof parsed.error === "string") {
					return parsed.error;
				}
				if (typeof parsed.error?.message === "string") {
					return parsed.error.message;
				}
			} catch {
				// Fall through to other representations.
			}
		}
		if (typeof apiError.message === "string" && apiError.message.trim()) {
			return apiError.message;
		}
	}

	if (
		error &&
		typeof error === "object" &&
		"cause" in error &&
		(error as { cause?: unknown }).cause
	) {
		return extractErrorMessage((error as { cause: unknown }).cause);
	}

	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}

	return String(error);
}

function extractGoogleThoughtMetadata(
	part: AiSdkStreamPart,
): Record<string, unknown> | undefined {
	const metadata: Record<string, unknown> = {};

	if (typeof part.thoughtSignature === "string") {
		metadata.thoughtSignature = part.thoughtSignature;
	}
	if (typeof part.thought_signature === "string") {
		metadata.thought_signature = part.thought_signature;
	}

	const providerMetadata =
		part.providerMetadata && typeof part.providerMetadata === "object"
			? (part.providerMetadata as Record<string, unknown>)
			: undefined;
	const googleMetadata =
		providerMetadata?.google && typeof providerMetadata.google === "object"
			? (providerMetadata.google as Record<string, unknown>)
			: undefined;

	if (
		typeof metadata.thoughtSignature !== "string" &&
		typeof googleMetadata?.thoughtSignature === "string"
	) {
		metadata.thoughtSignature = googleMetadata.thoughtSignature;
	}
	if (
		typeof metadata.thought_signature !== "string" &&
		typeof googleMetadata?.thought_signature === "string"
	) {
		metadata.thought_signature = googleMetadata.thought_signature;
	}

	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

async function* emitAiSdkEvents(
	stream: AiSdkStreamResult,
	pricingValue?: unknown,
): AsyncIterable<AgentModelEvent> {
	let sawToolCalls = false;
	let finishReason: unknown;

	if (stream.fullStream) {
		for await (const part of stream.fullStream) {
			if (part.type === "text-delta") {
				const text =
					(part.textDelta as string | undefined) ??
					(part.text as string | undefined) ??
					(part.delta as string | undefined);
				if (text) {
					yield { type: "text-delta", text };
				}
				continue;
			}

			if (part.type === "reasoning-delta" || part.type === "reasoning") {
				const text =
					(part.textDelta as string | undefined) ??
					(part.text as string | undefined) ??
					(part.reasoning as string | undefined);
				if (text) {
					yield {
						type: "reasoning-delta",
						text,
						metadata: extractGoogleThoughtMetadata(part),
					};
				}
				continue;
			}

			if (part.type === "tool-call") {
				sawToolCalls = true;
				const input = (part.input ?? part.args ?? {}) as unknown;
				yield {
					type: "tool-call-delta",
					toolCallId:
						(part.toolCallId as string | undefined) ??
						(part.id as string | undefined) ??
						`tool_${nanoid()}`,
					toolName:
						(part.toolName as string | undefined) ??
						(part.name as string | undefined) ??
						"tool",
					input: typeof input === "string" ? undefined : input,
					inputText: typeof input === "string" ? input : JSON.stringify(input),
					metadata: extractGoogleThoughtMetadata(part),
				};
				continue;
			}

			if (part.type === "finish") {
				yield {
					type: "usage",
					usage: normalizeUsage(
						part.usage ?? part.totalUsage ?? {},
						part.providerMetadata,
						pricingValue,
					),
				};
				finishReason = part.finishReason ?? part.reason;
			}
		}
	} else if (stream.textStream) {
		for await (const text of stream.textStream) {
			yield { type: "text-delta", text };
		}
	}

	if (stream.usage) {
		const usage = await stream.usage;
		yield {
			type: "usage",
			usage: normalizeUsage(usage, undefined, pricingValue),
		};
	}

	yield {
		type: "finish",
		reason: mapFinishReason(finishReason, sawToolCalls),
	};
}

async function createProviderModule(
	kind: ProviderModuleKind,
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	switch (kind) {
		case "openai": {
			const { createOpenAIProviderModule } = await import("./providers/openai");
			return createOpenAIProviderModule(config, context);
		}
		case "openai-compatible": {
			const { createOpenAICompatibleProviderModule } = await import(
				"./providers/openai-compatible"
			);
			return createOpenAICompatibleProviderModule(config, context);
		}
		case "anthropic": {
			const { createAnthropicProviderModule } = await import(
				"./providers/anthropic"
			);
			return createAnthropicProviderModule(config, context);
		}
		case "google": {
			const { createGoogleProviderModule } = await import("./providers/google");
			return createGoogleProviderModule(config, context);
		}
		case "vertex": {
			const { createVertexProviderModule } = await import("./providers/vertex");
			return createVertexProviderModule(config, context);
		}
		case "bedrock": {
			const { createBedrockProviderModule } = await import(
				"./providers/bedrock"
			);
			return createBedrockProviderModule(config);
		}
		case "mistral": {
			const { createMistralProviderModule } = await import(
				"./providers/mistral"
			);
			return createMistralProviderModule(config);
		}
		case "claude-code": {
			const { createClaudeCodeProviderModule } = await import(
				"./providers/community"
			);
			return createClaudeCodeProviderModule(config);
		}
		case "openai-codex": {
			const { createOpenAICodexProviderModule } = await import(
				"./providers/community"
			);
			return createOpenAICodexProviderModule(config);
		}
		case "opencode": {
			const { createOpenCodeProviderModule } = await import(
				"./providers/community"
			);
			return createOpenCodeProviderModule(config);
		}
		case "dify": {
			const { createDifyProviderModule } = await import(
				"./providers/community"
			);
			return createDifyProviderModule(config);
		}
	}
}

function createAiSdkProvider(kind: ProviderModuleKind): GatewayProviderFactory {
	return async (config) => ({
		async *stream(request, context) {
			try {
				const provider = await createProviderModule(kind, config, context);
				const langfuse = await ensureGatewayLangfuseTelemetry(
					config.providerId,
				);
				const stream = streamText({
					model: provider.model(context.model.id) as never,
					messages: (shouldUseAnthropicPromptCache(request, context)
						? buildCachedAiSdkMessages(request, context, request.systemPrompt)
						: toAiSdkMessages(request.messages, request.systemPrompt)) as never,
					tools: toAiSdkTools(request) as never,
					temperature: request.temperature,
					maxOutputTokens: request.maxTokens,
					abortSignal: request.signal,
					experimental_telemetry: {
						isEnabled: langfuse,
					},
					providerOptions: toAiSdkProviderOptions(request, context) as never,
				}) as unknown as AiSdkStreamResult;

				yield* emitAiSdkEvents(stream, context.model.metadata?.pricing);
			} catch (error) {
				yield {
					type: "finish",
					reason: "error",
					error: extractErrorMessage(error),
				};
			}
		},
	});
}

export const createOpenAIProvider = createAiSdkProvider("openai");
export const createOpenAICompatibleProvider =
	createAiSdkProvider("openai-compatible");
export const createAnthropicProvider = createAiSdkProvider("anthropic");
export const createGoogleProvider = createAiSdkProvider("google");
export const createVertexProvider = createAiSdkProvider("vertex");
export const createBedrockProvider = createAiSdkProvider("bedrock");
export const createMistralProvider = createAiSdkProvider("mistral");
export const createClaudeCodeProvider = createAiSdkProvider("claude-code");
export const createOpenAICodexProvider = createAiSdkProvider("openai-codex");
export const createOpenCodeProvider = createAiSdkProvider("opencode");
export const createDifyProvider = createAiSdkProvider("dify");
