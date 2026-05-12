import type {
	AgentMessage,
	AgentModelEvent,
	AgentModelFinishReason,
	GatewayProviderContext,
	GatewayProviderFactory,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
} from "@cline/shared";
import {
	type AiSdkFormatterMessage,
	type AiSdkFormatterPart,
	captureSdkError,
	formatMessagesForAiSdk,
	sanitizeSurrogates,
} from "@cline/shared";
import { jsonSchema, streamText } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { extractErrorMessage } from "./format";
import {
	applyPromptCacheToLastTextPart,
	isAnthropicCompatibleModel,
	resolveModelFamily,
	shouldUseAnthropicPromptCache,
} from "./routing/anthropic-compatible";
import {
	type AiSdkProviderOptionsTarget,
	composeAiSdkProviderOptions,
} from "./routing/provider-options";
import type {
	AiSdkStreamPart,
	AiSdkStreamResult,
	AiSdkStreamTotalUsage,
	AiSdkStreamUsage,
	ProviderFactoryResult,
} from "./vendors/types";

interface GatewayNormalizedUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	totalCost?: number;
}
type ProviderModuleKind = AiSdkProviderOptionsTarget;

function buildCachedAiSdkMessages(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	systemPrompt?: string,
) {
	const aiMessages = toAiSdkMessages(request.messages, systemPrompt) as Array<
		Record<string, unknown>
	>;
	const includeAnthropic = isAnthropicCompatibleModel({
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

async function ensureGatewayLangfuseTelemetry(
	providerId: string,
): Promise<boolean> {
	try {
		const runtime = await import("../services/langfuse-telemetry");
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
				content.push({ type: "text", text: sanitizeSurrogates(part.text) });
				continue;
			}

			if (part.type === "reasoning") {
				const metadata = part.metadata as Record<string, unknown> | undefined;
				const signature = metadata?.signature;
				const redactedData = metadata?.redactedData;
				content.push({
					type: "reasoning",
					text: sanitizeSurrogates(part.text),
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

			if (part.type === "file") {
				content.push({
					type: "file",
					path: part.path,
					content: part.content,
				});
				continue;
			}

			if (part.type === "image") {
				content.push({
					type: "image",
					image: part.image,
					mediaType: part.mediaType,
				});
				continue;
			}

			if (part.type === "tool-call") {
				const metadata = part.metadata as Record<string, unknown> | undefined;
				const thoughtSignature =
					metadata?.thoughtSignature ?? metadata?.thought_signature;
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
				inputSchema: jsonSchema(
					normalizeAiSdkToolInputSchema(definition.inputSchema),
					{
						validate: async (value) => {
							const result = await z
								.fromJSONSchema(definition.inputSchema)
								.safeParseAsync(value);
							return result.success
								? { success: true, value: result.data }
								: { success: false, error: result.error };
						},
					},
				) as never,
			} as unknown,
		]),
	);
}

function normalizeAiSdkToolInputSchema(
	inputSchema: Record<string, unknown>,
): Record<string, unknown> {
	if (inputSchema.type === "object") {
		return inputSchema;
	}

	return {
		type: "object",
		...inputSchema,
	};
}

function providerDisablesExternalToolExecution(
	context: GatewayProviderContext,
): boolean {
	return context.provider.capabilities?.includes("provider-tools") ?? false;
}

function mergeToolCallMetadata(
	current: unknown,
	patch: Record<string, unknown>,
): Record<string, unknown> {
	if (!current || typeof current !== "object" || Array.isArray(current)) {
		return patch;
	}
	return {
		...(current as Record<string, unknown>),
		...patch,
	};
}

function buildToolCallMetadata(input: {
	metadata: unknown;
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
}): Record<string, unknown> {
	return mergeToolCallMetadata(input.metadata, {
		toolSource: {
			providerId: input.request.providerId,
			modelId: input.request.modelId,
			executionMode: providerDisablesExternalToolExecution(input.context)
				? "provider"
				: "runtime",
		},
	});
}

function buildRecoverableToolErrorMetadata(input: {
	part: AiSdkStreamPart;
	errorMessage: string;
	request: GatewayStreamRequest;
	context: GatewayProviderContext;
	toolName: string;
}): Record<string, unknown> {
	return buildToolCallMetadata({
		metadata: mergeToolCallMetadata(extractGoogleThoughtMetadata(input.part), {
			inputParseError: `Tool call ${input.toolName} was rejected before execution: ${input.errorMessage}`,
			aiSdkToolError: input.errorMessage,
		}),
		request: input.request,
		context: input.context,
	});
}

function resolveAiSdkSystemPrompt(
	request: GatewayStreamRequest,
): string | undefined {
	return request.providerId === "openai-codex"
		? undefined
		: request.systemPrompt;
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
	return getNumericValue(current) ?? 0;
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
	usage: Omit<GatewayNormalizedUsage, "totalCost">,
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

/**
 * Normalizes usage from various provider formats into a standard structure.
 * Handles multiple naming conventions (e.g., inputTokens vs input_tokens),
 * extracts costs from market_cost/cost/upstream_inference_cost fields,
 * and falls back to pricing-based calculation if no explicit cost is found.
 * For providers that charge both gateway and model costs (e.g., OpenRouter),
 * sums baseCost + upstreamInferenceCost when both are present.
 */
/**
 * Normalizes usage from various provider formats into a standard structure.
 * Accepts both AI SDK's normalized shapes (AiSdkStreamTotalUsage, AiSdkStreamUsage)
 * and raw provider responses. Handles multiple naming conventions (camelCase vs snake_case),
 * extracts costs from provider-specific fields, and falls back to pricing-based calculation.
 *
 * @param usageValue - AI SDK normalized usage or raw provider response object
 * @param providerMetadata - Provider-specific metadata for cost extraction
 * @param pricingValue - Fallback pricing config (per 1M tokens) when no explicit cost found
 */
export function normalizeUsage(
	usageValue:
		| AiSdkStreamUsage
		| AiSdkStreamTotalUsage
		| Record<string, unknown>
		| undefined,
	providerMetadata?: unknown,
	pricingValue?: unknown,
): GatewayNormalizedUsage {
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
	const rawUsage =
		usage.raw && typeof usage.raw === "object"
			? (usage.raw as Record<string, unknown>)
			: usage;
	const upstreamInferenceCost =
		getNumericValue(
			(rawUsage.cost_details as Record<string, unknown> | undefined)
				?.upstream_inference_cost,
		) ?? getNumericValue(rawUsage.upstream_inference_cost);
	const marketCost =
		getNumericValue(rawUsage.market_cost) ??
		getNumericValue(rawUsage.marketCost) ??
		getNumericValue(gatewayMetadata.marketCost);
	const baseCost =
		getNumericValue(rawUsage.cost) ?? getNumericValue(gatewayMetadata.cost);
	const hasExplicitCost =
		marketCost !== undefined ||
		baseCost !== undefined ||
		upstreamInferenceCost !== undefined;
	const totalCost =
		marketCost ??
		(baseCost !== undefined && upstreamInferenceCost !== undefined
			? baseCost + upstreamInferenceCost
			: (baseCost ?? upstreamInferenceCost));
	const normalizedUsage = {
		inputTokens:
			getNestedUsageValue(usage, "inputTokens", "total") ||
			getUsageValue(usage, "inputTokens", "input_tokens", "prompt_tokens") ||
			getUsageValue(rawUsage, "promptTokenCount", "prompt_token_count"),
		outputTokens:
			getNestedUsageValue(usage, "outputTokens", "total") ||
			getUsageValue(
				usage,
				"outputTokens",
				"output_tokens",
				"completion_tokens",
			) ||
			getUsageValue(rawUsage, "candidatesTokenCount", "candidates_token_count"),
		cacheReadTokens:
			getNestedUsageValue(usage, "inputTokens", "cacheRead") ||
			getNestedUsageValue(usage, "inputTokenDetails", "cacheReadTokens") ||
			getUsageValue(
				usage,
				"cachedInputTokens",
				"cacheReadTokens",
				"cache_read_tokens",
				"cache_read_input_tokens",
			) ||
			getNestedUsageValue(usage, "prompt_tokens_details", "cached_tokens") ||
			getUsageValue(rawUsage, "cachedContentTokenCount") ||
			getNestedUsageValue(rawUsage, "prompt_tokens_details", "cached_tokens") ||
			getUsageValue(
				providerUsage ?? {},
				"cachedInputTokens",
				"cacheReadTokens",
				"cache_read_tokens",
				"cache_read_input_tokens",
			),
		cacheWriteTokens:
			getNestedUsageValue(usage, "inputTokens", "cacheWrite") ||
			getNestedUsageValue(usage, "inputTokenDetails", "cacheWriteTokens") ||
			getUsageValue(
				usage,
				"cacheWriteTokens",
				"cache_write_tokens",
				"cache_creation_input_tokens",
			) ||
			getUsageValue(
				rawUsage,
				"cacheWriteTokens",
				"cache_write_tokens",
				"cache_creation_input_tokens",
			) ||
			getNestedUsageValue(
				rawUsage,
				"prompt_tokens_details",
				"cache_write_tokens",
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

/**
 * Suppress unhandled rejections from AI SDK stream promises (usage, finishReason, etc.)
 * that reject with NoOutputGeneratedError when the stream encounters an error.
 *
 * The AI SDK's streamText result exposes lazy promise getters (finishReason, totalUsage,
 * steps, text, usage, etc.) backed by internal DelayedPromise instances. When the stream
 * errors with 0 recorded steps, the flush callback rejects all of them. We must access
 * each getter to obtain the promise and attach a no-op rejection handler before Bun/Node
 * surfaces them as unhandled rejections.
 */
function suppressDanglingStreamPromises(
	stream: AiSdkStreamResult | undefined,
): void {
	if (!stream) return;
	const noop = () => {};
	const suppress = (val: unknown) => {
		if (val && typeof (val as Promise<unknown>).catch === "function") {
			(val as Promise<unknown>).catch(noop);
		}
	};

	// Access known lazy promise getters on the AI SDK StreamTextResult object.
	const s = stream as Record<string, unknown>;

	// Catch-all for any remaining promise-valued own properties.
	for (const key of Object.keys(stream)) {
		try {
			suppress(s[key]);
		} catch {
			// ignore
		}
	}
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
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	pricingValue?: unknown,
	capturedError?: { current: string | undefined },
): AsyncIterable<AgentModelEvent> {
	let sawToolCalls = false;
	const emittedToolCallIds = new Set<string>();
	let finishReason: unknown;
	let streamError: string | undefined;
	let finishUsage: unknown;
	let finishProviderMetadata: unknown;

	try {
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
					const toolCallId =
						(part.toolCallId as string | undefined) ??
						(part.id as string | undefined) ??
						`tool_${nanoid()}`;
					emittedToolCallIds.add(toolCallId);
					const input = (part.input ?? part.args ?? {}) as unknown;
					const inputText =
						typeof input === "string" ? input : JSON.stringify(input);
					yield {
						type: "tool-call-delta",
						toolCallId,
						toolName:
							(part.toolName as string | undefined) ??
							(part.name as string | undefined) ??
							"tool",
						input: typeof input === "string" ? undefined : input,
						inputText,
						metadata: buildToolCallMetadata({
							metadata: extractGoogleThoughtMetadata(part),
							request,
							context,
						}),
					};
					continue;
				}

				if (part.type === "tool-error") {
					sawToolCalls = true;
					const toolCallId =
						(part.toolCallId as string | undefined) ??
						(part.id as string | undefined) ??
						`tool_${nanoid()}`;
					const alreadyEmitted = emittedToolCallIds.has(toolCallId);
					emittedToolCallIds.add(toolCallId);
					const toolName =
						(part.toolName as string | undefined) ??
						(part.name as string | undefined) ??
						"tool";
					const input = (part.input ?? part.args ?? {}) as unknown;
					const inputText =
						typeof input === "string" ? input : JSON.stringify(input);
					const errorMessage =
						part.error === undefined
							? "Tool input was rejected by the model adapter"
							: extractErrorMessage(part.error);
					yield {
						type: "tool-call-delta",
						toolCallId,
						toolName,
						input: alreadyEmitted
							? undefined
							: typeof input === "string"
								? undefined
								: input,
						inputText: alreadyEmitted ? undefined : inputText,
						metadata: buildRecoverableToolErrorMetadata({
							part,
							errorMessage,
							request,
							context,
							toolName,
						}),
					};
					continue;
				}

				if (part.type === "finish") {
					finishUsage = part.usage ?? part.totalUsage;
					finishProviderMetadata = part.providerMetadata;
					finishReason =
						part.finishReason ?? part.rawFinishReason ?? part.reason;
				}

				if (part.type === "error") {
					streamError =
						capturedError?.current ?? extractErrorMessage(part.error);
					break;
				}

				if (part.type === "abort") {
					// abort
					break;
				}
			}
		} else if (stream.textStream) {
			for await (const text of stream.textStream) {
				yield { type: "text-delta", text };
			}
		}
	} catch (error) {
		// Prefer the real provider error from onError over the generic
		// NoOutputGeneratedError the AI SDK throws when 0 steps are recorded.
		streamError = capturedError?.current ?? extractErrorMessage(error);
	}

	// Prefer stream.usage (has raw cost data) over finish part usage.
	// stream.usage may be undefined in mocked/test scenarios, fall back to finish part + its providerMetadata.
	let usageToEmit: unknown;
	let metadataToUse: unknown;
	if (streamError) {
		usageToEmit = finishUsage;
		metadataToUse = finishProviderMetadata;
	} else if (stream.usage) {
		try {
			usageToEmit = await stream.usage;
		} catch (error) {
			if (!streamError) {
				streamError = capturedError?.current ?? extractErrorMessage(error);
			}
			usageToEmit = finishUsage;
			metadataToUse = finishProviderMetadata;
		}
	} else {
		usageToEmit = finishUsage;
		metadataToUse = finishProviderMetadata;
	}

	if (usageToEmit) {
		yield {
			type: "usage",
			usage: normalizeUsage(usageToEmit, metadataToUse, pricingValue),
		};
	}

	yield {
		type: "finish",
		reason: streamError ? "error" : mapFinishReason(finishReason, sawToolCalls),
		error: streamError,
	};
}

async function createProviderModule(
	kind: ProviderModuleKind,
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	switch (kind) {
		case "openai": {
			const { createOpenAIProviderModule } = await import("./vendors/openai");
			return createOpenAIProviderModule(config, context);
		}
		case "openai-compatible": {
			const { createOpenAICompatibleProviderModule } = await import(
				"./vendors/openai-compatible"
			);
			return createOpenAICompatibleProviderModule(config, context);
		}
		case "anthropic": {
			const { createAnthropicProviderModule } = await import(
				"./vendors/anthropic"
			);
			return createAnthropicProviderModule(config, context);
		}
		case "google": {
			const { createGoogleProviderModule } = await import("./vendors/google");
			return createGoogleProviderModule(config, context);
		}
		case "vertex": {
			const { createVertexProviderModule } = await import("./vendors/vertex");
			return createVertexProviderModule(config, context);
		}
		case "bedrock": {
			const { createBedrockProviderModule } = await import("./vendors/bedrock");
			return createBedrockProviderModule(config);
		}
		case "mistral": {
			const { createMistralProviderModule } = await import("./vendors/mistral");
			return createMistralProviderModule(config);
		}
		case "claude-code": {
			const { createClaudeCodeProviderModule } = await import(
				"./vendors/community"
			);
			return createClaudeCodeProviderModule(config);
		}
		case "openai-codex": {
			const { createOpenAICodexProviderModule } = await import(
				"./vendors/community"
			);
			return createOpenAICodexProviderModule(config);
		}
		case "opencode": {
			const { createOpenCodeProviderModule } = await import(
				"./vendors/community"
			);
			return createOpenCodeProviderModule(config);
		}
		case "dify": {
			const { createDifyProviderModule } = await import("./vendors/community");
			return createDifyProviderModule(config);
		}
	}
}

function createAiSdkProvider(kind: ProviderModuleKind): GatewayProviderFactory {
	return async (config) => ({
		async *stream(request, context) {
			const log = context.logger;
			let stream: AiSdkStreamResult | undefined;
			const capturedError: { current: string | undefined } = {
				current: undefined,
			};
			try {
				const provider = await createProviderModule(kind, config, context);
				const langfuse = await ensureGatewayLangfuseTelemetry(
					config.providerId,
				);
				const tools = providerDisablesExternalToolExecution(context)
					? undefined
					: toAiSdkTools(request);
				const systemPrompt = resolveAiSdkSystemPrompt(request);
				const useSystemOption =
					typeof systemPrompt === "string" && systemPrompt.trim().length > 0;
				const messagesSystemPrompt = useSystemOption ? undefined : systemPrompt;
				stream = streamText({
					model: provider.model(context.model.id) as never,
					messages: (shouldUseAnthropicPromptCache(request, context)
						? buildCachedAiSdkMessages(request, context, messagesSystemPrompt)
						: toAiSdkMessages(request.messages, messagesSystemPrompt)) as never,
					...(useSystemOption ? { system: systemPrompt } : {}),
					tools: tools as never,
					temperature: request.temperature,
					maxOutputTokens: request.maxTokens,
					abortSignal: request.signal,
					experimental_telemetry: {
						isEnabled: langfuse,
					},
					providerOptions: composeAiSdkProviderOptions(
						request,
						context,
						kind,
					) as never,
					onError: ({ error: streamError }) => {
						const msg = extractErrorMessage(streamError);
						capturedError.current = msg;
						if (log?.error) {
							log.error("[ai-sdk] stream error", {
								providerId: request.providerId,
								error: streamError,
								severity: "error",
							});
						} else if (log) {
							log.log(`[ai-sdk] stream error: ${msg}`, {
								providerId: request.providerId,
								severity: "error",
							});
						}
						captureSdkError(context.telemetry, {
							component: "llms",
							operation: "provider.stream",
							error: streamError,
							severity: "error",
							handled: true,
							context: {
								providerId: request.providerId,
								modelId: request.modelId,
								providerKind: kind,
							},
						});
					},
				}) as unknown as AiSdkStreamResult;

				// Suppress dangling promise rejections (finishReason, totalUsage, steps, etc.)
				// BEFORE iterating. The AI SDK rejects these DelayedPromises inside the stream's
				// flush callback, which runs during iteration, so we must attach .catch() handlers
				// upfront or Bun/Node will surface them as unhandled rejections.
				suppressDanglingStreamPromises(stream);

				yield* emitAiSdkEvents(
					stream,
					request,
					context,
					context.model.metadata?.pricing,
					capturedError,
				);
			} catch (error) {
				suppressDanglingStreamPromises(stream);
				// Prefer the real provider error captured in onError over the generic
				// NoOutputGeneratedError that the AI SDK throws when 0 steps are recorded.
				const msg = capturedError.current ?? extractErrorMessage(error);
				if (log?.error) {
					log.error("[ai-sdk] provider error", {
						providerId: request.providerId,
						error,
						severity: "error",
					});
				} else if (log) {
					log.log(`[ai-sdk] provider error: ${msg}`, {
						providerId: request.providerId,
						severity: "error",
					});
				}
				captureSdkError(context.telemetry, {
					component: "llms",
					operation: "provider.create_or_stream",
					error,
					severity: "error",
					handled: true,
					context: {
						providerId: request.providerId,
						modelId: request.modelId,
						providerKind: kind,
					},
				});
				yield {
					type: "finish",
					reason: "error",
					error: msg,
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
