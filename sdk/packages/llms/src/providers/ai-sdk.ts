import type { LanguageModelV4 } from "@ai-sdk/provider";
import type {
	AgentMessage,
	AgentModelEvent,
	AgentModelFinishReason,
	GatewayProviderContext,
	GatewayProviderFactory,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
	GeneratedMedia,
	ImageMediaValidationFailure,
	ImageMediaValidationSuccess,
	MediaBudgetState,
	ModelToolExecution,
	ModelToolName,
	ProviderErrorClass,
} from "@cline/shared";
import {
	type AiSdkFormatterMessage,
	type AiSdkFormatterPart,
	captureSdkError,
	createMediaBudgetState,
	formatMessagesForAiSdk,
	GeneratedMediaSchema,
	generatedMediaModalityFromMediaType,
	modelProducesImages,
	modelSupportsToolCalling,
	parseJsonStream,
	sanitizeSurrogates,
	usesImageGenerationOperation,
	validateAndReserveBase64Media,
	validateAndReserveImageMedia,
	validateImageMedia,
} from "@cline/shared";
import {
	type CallSettings,
	generateImage,
	jsonSchema,
	NoSuchToolError,
	stepCountIs,
	streamText,
	type ToolSet,
	wrapLanguageModel,
} from "ai";
import { nanoid } from "nanoid";
import { classifyProviderError } from "./error-classification";
import { extractErrorMessage } from "./format";
import { createRetryEmptyResponseMiddleware } from "./middleware/retry-empty-response";
import {
	isAnthropicCompatibleModel,
	isCerebrasProvider,
	modelSupportsImageInput,
	resolveModelFamily,
} from "./model-facts";
import {
	recordProviderRequestCapture,
	wrapFetchForProviderRequestCapture,
} from "./provider-request-capture";
import {
	applyPromptCacheToLastTextPart,
	shouldApplyPromptCache,
} from "./routing/anthropic-compatible";
import {
	applyBedrockCachePointToLastUserMessage,
	shouldApplyBedrockCachePoint,
} from "./routing/bedrock-cache-point";
import { resolvePortableReasoning } from "./routing/portable-reasoning";
import {
	type AiSdkProviderOptionsTarget,
	composeAiSdkProviderOptions,
} from "./routing/provider-options";
import type {
	AiSdkStreamPart,
	AiSdkStreamResult,
	AiSdkStreamTotalUsage,
	AiSdkStreamUsage,
	BuiltModelTools,
	ProviderFactoryResult,
	ProviderGeneratedMedia,
} from "./vendors/types";

interface GatewayNormalizedUsage {
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
	reasoningTokenCount?: number;
	totalCost?: number;
}
type ProviderModuleKind = AiSdkProviderOptionsTarget;
type ImageGenerationInput = string | Uint8Array | ArrayBuffer;
type ImageGenerationPrompt =
	| string
	| {
			images: ImageGenerationInput[];
			text?: string;
	  };

function normalizeImageGenerationInput(
	part: Extract<AgentMessage["content"][number], { type: "image" }>,
): ImageGenerationInput {
	if (part.image instanceof URL) {
		return part.image.href;
	}
	if (typeof part.image !== "string") {
		return part.image;
	}
	if (part.image.startsWith("http://") || part.image.startsWith("https://")) {
		return part.image;
	}
	const validation = validateImageMedia(part.mediaType, part.image);
	if (!validation.ok) {
		throw new Error(validation.message);
	}
	return `data:${validation.mediaType};base64,${validation.base64}`;
}

function normalizeGeneratedImageInput(
	part: Extract<AgentMessage["content"][number], { type: "media" }>,
): ImageGenerationInput | undefined {
	if (part.media.modality !== "image") return undefined;
	switch (part.media.source.type) {
		case "url":
			return part.media.source.url;
		case "artifact":
			return undefined;
		case "base64": {
			const validation = validateImageMedia(
				part.media.mediaType,
				part.media.source.data,
			);
			return validation.ok
				? `data:${validation.mediaType};base64,${validation.base64}`
				: undefined;
		}
	}
}

function resolveImageGenerationPrompt(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): ImageGenerationPrompt {
	let latestUserMessageIndex = -1;
	for (let index = request.messages.length - 1; index >= 0; index -= 1) {
		if (request.messages[index]?.role === "user") {
			latestUserMessageIndex = index;
			break;
		}
	}
	if (latestUserMessageIndex < 0) {
		throw new Error("Image generation requires a text prompt or input image");
	}

	const message = request.messages[latestUserMessageIndex];
	if (!message || message.role !== "user") {
		throw new Error("Image generation requires a text prompt or input image");
	}
	const text = message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
	const supportsImageInput =
		context.model.modalities?.input.includes("image") === true;
	if (supportsImageInput) {
		const explicitImages = message.content
			.filter((part) => part.type === "image")
			.map(normalizeImageGenerationInput);
		if (explicitImages.length > 0) {
			return {
				images: explicitImages,
				...(text ? { text } : {}),
			};
		}
	}
	if (!text) {
		throw new Error("Image generation requires a text prompt or input image");
	}
	if (!supportsImageInput) {
		return text;
	}

	// Only infer an edit from the immediately preceding assistant turn. Looking
	// farther back can silently turn a new generation request into an edit of a
	// stale image from an unrelated part of the conversation.
	const previousMessage = request.messages[latestUserMessageIndex - 1];
	if (previousMessage?.role === "assistant") {
		const firstGeneratedImage = previousMessage.content.find(
			(part) =>
				part.type === "image" ||
				(part.type === "media" && part.media.modality === "image"),
		);
		if (firstGeneratedImage?.type === "image") {
			return {
				text,
				images: [normalizeImageGenerationInput(firstGeneratedImage)],
			};
		}
		if (firstGeneratedImage?.type === "media") {
			const input = normalizeGeneratedImageInput(firstGeneratedImage);
			if (input) return { text, images: [input] };
		}
	}
	return text;
}

type GeneratedImageExtraction =
	| { kind: "accepted"; image: ImageMediaValidationSuccess }
	| { kind: "rejected"; error: ImageMediaValidationFailure }
	| { kind: "unsupported" };

function toGeneratedImageMedia(
	image: ImageMediaValidationSuccess,
): GeneratedMedia {
	return {
		id: `media_${nanoid()}`,
		modality: "image",
		mediaType: image.mediaType,
		source: { type: "base64", data: image.base64 },
		sizeBytes: image.decodedBytes,
	};
}

function extractGeneratedImage(
	file: unknown,
	budgetState: MediaBudgetState,
): GeneratedImageExtraction {
	if (!file || typeof file !== "object") return { kind: "unsupported" };
	const record = file as Record<string, unknown>;
	if (
		typeof record.mediaType !== "string" ||
		!record.mediaType.startsWith("image/") ||
		typeof record.base64 !== "string"
	) {
		return { kind: "unsupported" };
	}
	// Generated images use the same bounded media envelope as attachments and
	// persisted history. Accepting an image that hydration later drops would
	// make the live and replayed assistant transcripts disagree.
	const validation = validateAndReserveImageMedia(
		record.mediaType,
		record.base64,
		{},
		budgetState,
	);
	if (!validation.ok) {
		return { kind: "rejected", error: validation };
	}
	return { kind: "accepted", image: validation };
}

type ProjectedMediaNormalization =
	| { ok: true; media: GeneratedMedia }
	| { ok: false; error: string };

function normalizeProjectedModelToolMedia(
	candidate: ProviderGeneratedMedia,
	budgetState: MediaBudgetState,
): ProjectedMediaNormalization {
	if (candidate.modality === "image" && candidate.source.type === "base64") {
		const extracted = extractGeneratedImage(
			{
				base64: candidate.source.data,
				mediaType: candidate.mediaType,
			},
			budgetState,
		);
		if (extracted.kind === "accepted") {
			return { ok: true, media: toGeneratedImageMedia(extracted.image) };
		}
		return {
			ok: false,
			error:
				extracted.kind === "rejected"
					? extracted.error.message
					: "Model tool returned unsupported image media",
		};
	}

	let source = candidate.source;
	let sizeBytes: number | undefined;
	if (candidate.source.type === "base64") {
		const validation = validateAndReserveBase64Media(
			candidate.source.data,
			{},
			budgetState,
		);
		if (!validation.ok) {
			return { ok: false, error: validation.message };
		}
		source = { type: "base64", data: validation.base64 };
		sizeBytes = validation.decodedBytes;
	}

	const media = {
		...candidate,
		id: `media_${nanoid()}`,
		source,
		...(sizeBytes !== undefined ? { sizeBytes } : {}),
	};
	const parsed = GeneratedMediaSchema.safeParse(media);
	return parsed.success
		? { ok: true, media: parsed.data }
		: { ok: false, error: "Model tool returned invalid generated media" };
}

interface ActiveProjectedModelToolCall {
	toolName: ModelToolName;
	input?: unknown;
	execution: ModelToolExecution;
}

interface ProjectedModelToolResult {
	media: GeneratedMedia[];
	activityOutput: unknown;
}

function summarizeProjectedMedia(media: readonly GeneratedMedia[]): unknown {
	return {
		generatedMediaCount: media.length,
		mediaTypes: media.map((item) => item.mediaType),
		byteLength: media.reduce((total, item) => total + (item.sizeBytes ?? 0), 0),
	};
}

export function buildAiSdkStreamConfig(
	request: GatewayStreamRequest,
	_context: GatewayProviderContext,
): Partial<CallSettings> {
	const reasoning = resolvePortableReasoning(request);
	return {
		...(request.maxTokens !== undefined
			? { maxOutputTokens: request.maxTokens }
			: {}),
		temperature: request.temperature,
		...(reasoning ? { reasoning } : {}),
	};
}

function buildProviderModelTools(
	provider: ProviderFactoryResult,
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): BuiltModelTools | undefined {
	if (!request.modelTools?.length) {
		return undefined;
	}

	const requestedNames = [
		...new Set(request.modelTools.map((tool) => tool.name)),
	];
	if (!provider.buildModelTools) {
		throw new Error(
			`Provider adapter for "${context.provider.id}" does not implement requested model tool(s): ${requestedNames.join(", ")}.`,
		);
	}

	const modelTools = provider.buildModelTools(request.modelTools);
	const missingNames = requestedNames.filter(
		(toolName) => !Object.hasOwn(modelTools, toolName),
	);
	if (missingNames.length > 0) {
		throw new Error(
			`Provider adapter for "${context.provider.id}" did not build requested model tool(s): ${missingNames.join(", ")}.`,
		);
	}

	return modelTools;
}

function toAiSdkModelToolSet(
	modelTools: BuiltModelTools | undefined,
): ToolSet | undefined {
	if (!modelTools) return undefined;
	const entries = Object.entries(modelTools).flatMap(([name, adapter]) =>
		adapter ? [[name, adapter.tool] as const] : [],
	);
	return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function buildAiSdkRequestMessages(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	systemPrompt?: string,
) {
	const aiMessages = toAiSdkMessages(request.messages, systemPrompt, {
		includeReasoning: shouldIncludeReasoningHistory(request, context),
		supportedInputModalities:
			context.model.modalities?.input ??
			(context.model.capabilities
				? modelSupportsImageInput(context)
					? ["text", "image"]
					: ["text"]
				: undefined),
	}) as Array<Record<string, unknown>>;

	if (shouldApplyBedrockCachePoint(request, context)) {
		applyBedrockCachePointToLastUserMessage(aiMessages);
		return aiMessages;
	}

	if (!shouldApplyPromptCache(request, context)) {
		return aiMessages;
	}

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

function resolveStickySession(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
):
	| {
			transport: "json-body" | "header";
			field: string;
			value: string;
	  }
	| undefined {
	const stickySession = context.provider.metadata?.stickySession;
	if (!stickySession) {
		return undefined;
	}
	const metadata = request.metadata;
	const value =
		metadata && typeof metadata === "object"
			? metadata[stickySession.metadataKey]
			: undefined;
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}
	return {
		transport: stickySession.transport,
		field: stickySession.field,
		value: trimmed,
	};
}

type FetchBodyText =
	| { source: "init-body"; text: string }
	| { request: Request; source: "request"; text: string };

async function bodyTextFromFetchInput(
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
): Promise<FetchBodyText | undefined> {
	const body = init?.body;
	if (body === null) {
		return undefined;
	}
	if (typeof body === "string") {
		return { source: "init-body", text: body };
	}
	if (body instanceof URLSearchParams) {
		return { source: "init-body", text: body.toString() };
	}
	if (body instanceof ArrayBuffer) {
		return { source: "init-body", text: Buffer.from(body).toString("utf8") };
	}
	if (ArrayBuffer.isView(body)) {
		return {
			source: "init-body",
			text: Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString(
				"utf8",
			),
		};
	}
	if (body !== undefined) {
		return undefined;
	}
	if (input instanceof Request) {
		try {
			return {
				request: input,
				source: "request",
				text: await input.clone().text(),
			};
		} catch {
			return undefined;
		}
	}
	return undefined;
}

async function injectJsonBodyStickySession(
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
	stickySession: { field: string; value: string },
): Promise<Parameters<typeof fetch>> {
	const bodyText = await bodyTextFromFetchInput(input, init);
	if (!bodyText?.text.trim().startsWith("{")) {
		return [input, init];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(bodyText.text);
	} catch {
		return [input, init];
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return [input, init];
	}
	const body = parsed as Record<string, unknown>;
	const existingValue = body[stickySession.field];
	if (typeof existingValue !== "string" || !existingValue.trim()) {
		body[stickySession.field] = stickySession.value;
	}
	const nextBody = JSON.stringify(body);
	if (bodyText.source === "init-body") {
		return [input, { ...init, body: nextBody }];
	}
	return [new Request(bodyText.request, { body: nextBody }), init];
}

function injectHeaderStickySession(
	input: Parameters<typeof fetch>[0],
	init: Parameters<typeof fetch>[1],
	stickySession: { field: string; value: string },
): Parameters<typeof fetch> {
	const headers = new Headers(
		input instanceof Request ? input.headers : undefined,
	);
	new Headers(init?.headers).forEach((value, key) => {
		headers.set(key, value);
	});
	if (!headers.get(stickySession.field)?.trim()) {
		headers.set(stickySession.field, stickySession.value);
	}
	return [input, { ...init, headers }];
}

function wrapFetchForStickySession(
	baseFetch: typeof fetch | undefined,
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): typeof fetch | undefined {
	const stickySession = resolveStickySession(request, context);
	if (!stickySession) {
		return baseFetch;
	}
	const delegate = baseFetch ?? globalThis.fetch;
	if (!delegate) {
		return baseFetch;
	}
	const sessionFetch = (async (input, init) => {
		const [nextInput, nextInit] =
			stickySession.transport === "json-body"
				? await injectJsonBodyStickySession(input, init, stickySession)
				: injectHeaderStickySession(input, init, stickySession);
		return delegate(nextInput, nextInit);
	}) as typeof fetch;
	const delegateWithPreconnect = delegate as typeof fetch & {
		preconnect?: (...args: unknown[]) => unknown;
	};
	if (typeof delegateWithPreconnect.preconnect === "function") {
		(
			sessionFetch as typeof fetch & {
				preconnect?: (...args: unknown[]) => unknown;
			}
		).preconnect = delegateWithPreconnect.preconnect.bind(delegate);
	}
	return sessionFetch;
}

function shouldIncludeReasoningHistory(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): boolean {
	return !isCerebrasProvider(request, context);
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

async function withAiSdkLangfuseTraceContext<T>(
	enabled: boolean,
	request: GatewayStreamRequest,
	callback: () => T | Promise<T>,
): Promise<T> {
	const metadata =
		request.metadata && typeof request.metadata === "object"
			? request.metadata
			: {};
	const tags = Array.isArray(metadata.tags)
		? metadata.tags.filter(
				(value): value is string =>
					typeof value === "string" && value.trim().length > 0,
			)
		: undefined;
	const distinctId =
		typeof metadata.distinctId === "string" ? metadata.distinctId : undefined;
	const sessionId =
		typeof metadata.sessionId === "string" ? metadata.sessionId : undefined;

	if (!enabled || (!distinctId && !sessionId && !tags?.length)) {
		return await callback();
	}

	const runtime = await import("../services/langfuse-telemetry");
	return await runtime.withLangfuseTraceAttributes(
		true,
		{
			...(distinctId ? { userId: distinctId } : {}),
			...(sessionId ? { sessionId } : {}),
			...(tags?.length ? { tags } : {}),
			metadata: {
				...(typeof metadata.conversationId === "string"
					? { conversationId: metadata.conversationId }
					: {}),
				...(typeof metadata.runId === "string"
					? { runId: metadata.runId }
					: {}),
			},
		},
		callback,
	);
}

function buildAiSdkRuntimeContext(
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
): Record<string, unknown> {
	const requestMetadata = request.metadata;
	const metadata =
		requestMetadata && typeof requestMetadata === "object"
			? requestMetadata
			: {};
	const tags = Array.isArray(metadata.tags)
		? metadata.tags.filter(
				(value): value is string =>
					typeof value === "string" && value.trim().length > 0,
			)
		: undefined;
	const distinctId =
		typeof metadata.distinctId === "string" ? metadata.distinctId : undefined;

	return {
		// `distinctId` is Cline's canonical identity field. Langfuse's data
		// model calls the same value `userId`, so expose both in runtime
		// context and explicitly map distinctId to Langfuse's userId below.
		...(distinctId ? { distinctId, userId: distinctId } : {}),
		...(typeof metadata.sessionId === "string"
			? { sessionId: metadata.sessionId }
			: {}),
		...(typeof metadata.clientName === "string"
			? { clientName: metadata.clientName }
			: {}),
		...(typeof metadata.clientVersion === "string"
			? { clientVersion: metadata.clientVersion }
			: {}),
		...(typeof metadata.clineCoreVersion === "string"
			? { clineCoreVersion: metadata.clineCoreVersion }
			: {}),
		...(tags && tags.length > 0 ? { tags } : {}),
		// Keep Cline correlation fields available even when the integration
		// does not promote them to first-class Langfuse fields.
		...(typeof metadata.conversationId === "string"
			? { conversationId: metadata.conversationId }
			: {}),
		...(typeof metadata.runId === "string" ? { runId: metadata.runId } : {}),
		...(typeof metadata.iteration === "number"
			? { iteration: metadata.iteration }
			: {}),
		providerId: request.providerId,
		modelId: request.modelId,
		resolvedModelId: context.model.id,
	};
}

function toAiSdkMessages(
	messages: readonly AgentMessage[],
	systemPrompt?: string,
	options?: {
		includeReasoning?: boolean;
		supportedInputModalities?: readonly string[];
	},
) {
	const includeReasoning = options?.includeReasoning ?? true;
	const normalizedMessages: AiSdkFormatterMessage[] = [];

	for (const message of messages) {
		const content: AiSdkFormatterPart[] = [];
		let skippedReasoning = false;
		for (const part of message.content) {
			if (part.type === "text") {
				content.push({ type: "text", text: sanitizeSurrogates(part.text) });
				continue;
			}

			if (part.type === "reasoning") {
				if (!includeReasoning) {
					skippedReasoning = true;
					continue;
				}
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

			if (part.type === "media") {
				content.push({ type: "media", media: part.media });
				continue;
			}

			if (part.type === "tool-call") {
				const metadata = part.metadata as Record<string, unknown> | undefined;
				const thoughtSignature =
					metadata?.thoughtSignature ??
					metadata?.signature ??
					metadata?.thought_signature;
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

		// A message left empty only because its reasoning was dropped is
		// omitted entirely instead of forwarded as an empty turn.
		const emptiedByDroppedReasoning = !includeReasoning && skippedReasoning;
		if (content.length > 0) {
			normalizedMessages.push({ role: message.role, content });
		} else if (
			!emptiedByDroppedReasoning &&
			(message.role === "user" || message.role === "assistant")
		) {
			normalizedMessages.push({ role: message.role, content: "" });
		}
	}

	return formatMessagesForAiSdk(systemPrompt, normalizedMessages, {
		assistantToolCallArgKey: "input",
		supportedInputModalities: options?.supportedInputModalities,
	});
}

function toAiSdkTools(request: GatewayStreamRequest): ToolSet | undefined {
	if (!request.tools?.length) {
		return undefined;
	}

	// No validate callback on purpose: schema validation belongs to the tools
	// themselves (core executors validate with lenient union schemas that
	// accept common weak-model shapes like a bare string for a string[]
	// property). Rejecting here would return an error to the model without
	// the tool's own input handling ever seeing the call.
	const tools: ToolSet = {};
	for (const definition of request.tools) {
		tools[definition.name] = {
			description: definition.description,
			inputSchema: jsonSchema(
				normalizeAiSdkToolInputSchema(definition.inputSchema),
			),
		};
	}
	return tools;
}

function mergeAiSdkTools(
	runtimeTools: ToolSet | undefined,
	providerTools: ToolSet | undefined,
): ToolSet | undefined {
	// Runtime tools carry the caller's executor contract, so they retain
	// ownership when a provider happens to register the same public name.
	const tools = {
		...(providerTools ?? {}),
		...(runtimeTools ?? {}),
	};
	return Object.keys(tools).length > 0 ? tools : undefined;
}

function hasAiSdkTool(tools: ToolSet | undefined, toolName: string): boolean {
	return tools !== undefined && Object.hasOwn(tools, toolName);
}

interface RepairableToolCall {
	toolCallId: string;
	toolName: string;
	input: string;
}

/**
 * Last-chance repair for tool calls whose arguments are not valid JSON
 * (truncated payloads, single quotes, unescaped newlines — common with
 * weaker models). Runs the raw argument text through the shared jsonrepair
 * strategies; unknown tool names and already-valid JSON are not repairable
 * here, and returning null preserves the AI SDK's original error behavior.
 */
export async function repairMalformedToolCall<T extends RepairableToolCall>({
	toolCall,
	error,
}: {
	toolCall: T;
	error: unknown;
}): Promise<T | null> {
	if (NoSuchToolError.isInstance(error)) {
		return null;
	}
	if (typeof toolCall.input !== "string" || toolCall.input.trim() === "") {
		return null;
	}
	try {
		JSON.parse(toolCall.input);
		// Valid JSON means the failure was a schema mismatch, not a parse
		// error. That is left to the tool executor's own lenient union
		// schemas; there is nothing to repair here.
		return null;
	} catch {
		// Not valid JSON — attempt repair below.
	}
	const repaired = parseJsonStream(toolCall.input);
	if (repaired === toolCall.input || typeof repaired === "string") {
		return null;
	}
	return { ...toolCall, input: JSON.stringify(repaired) };
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
	// Kept distinct from the `stop` fallback below: a filtered turn that
	// produced no content must not be reported (or retried) as a transient
	// empty response — see `AgentModelFinishReason`.
	if (value === "content-filter" || value === "content_filter") {
		return "content-filter";
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

type UsagePath = readonly [string] | readonly [string, string];

const REASONING_TOKEN_PATHS: UsagePath[] = [
	["outputTokenDetails", "reasoningTokens"],
	["output_tokens_details", "reasoning_tokens"],
	["completion_tokens_details", "reasoning_tokens"],
	["reasoningTokens"],
	["reasoning_tokens"],
];

function getUsageValueByPath(source: unknown, path: UsagePath): number {
	let current: unknown = source;
	for (const key of path) {
		if (!current || typeof current !== "object") {
			return 0;
		}
		current = (current as Record<string, unknown>)[key];
	}
	return getNumericValue(current) ?? 0;
}

function firstUsageValue(sources: unknown[], paths: UsagePath[]): number {
	for (const source of sources) {
		for (const path of paths) {
			const value = getUsageValueByPath(source, path);
			if (value > 0) {
				return value;
			}
		}
	}
	return 0;
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
 * Accepts both AI SDK's normalized shapes (AiSdkStreamTotalUsage, AiSdkStreamUsage)
 * and raw provider responses. Handles multiple naming conventions (camelCase vs snake_case),
 * extracts costs from provider-specific fields, and falls back to pricing-based calculation.
 * Provider-reported billed cost takes precedence over market cost so gateway discounts
 * are reflected in user-facing totals. Market cost remains a fallback when no billed
 * cost is available.
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
	const isByokUsage =
		rawUsage.is_byok === true ||
		rawUsage.isByok === true ||
		gatewayMetadata.is_byok === true ||
		gatewayMetadata.isByok === true;
	const shouldAddUpstreamCost =
		isByokUsage &&
		baseCost !== undefined &&
		upstreamInferenceCost !== undefined;
	const costOrUpstream =
		baseCost !== undefined && baseCost > 0
			? baseCost
			: (upstreamInferenceCost ?? baseCost);
	const billedCost = shouldAddUpstreamCost
		? baseCost + upstreamInferenceCost
		: costOrUpstream;
	const totalCost =
		billedCost !== undefined && billedCost !== 0
			? billedCost
			: (marketCost ?? billedCost);
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
			getNestedUsageValue(rawUsage, "prompt_tokens_details", "cached_tokens") ||
			getUsageValue(rawUsage, "cachedContentTokenCount") ||
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
			getNestedUsageValue(
				usage,
				"prompt_tokens_details",
				"cache_write_tokens",
			) ||
			getUsageValue(
				usage,
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
				rawUsage,
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
	const reasoningTokenCount = firstUsageValue(
		[usage, rawUsage, providerUsage ?? {}],
		REASONING_TOKEN_PATHS,
	);
	const resolvedTotalCost =
		totalCost !== undefined
			? totalCost
			: hasExplicitCost
				? undefined
				: calculateUsageCostFromPricing(normalizedUsage, pricingValue);

	return {
		...normalizedUsage,
		...(reasoningTokenCount > 0 ? { reasoningTokenCount } : {}),
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
	const vertexMetadata =
		providerMetadata?.vertex && typeof providerMetadata.vertex === "object"
			? (providerMetadata.vertex as Record<string, unknown>)
			: undefined;

	if (
		typeof metadata.thoughtSignature !== "string" &&
		typeof (
			googleMetadata?.thoughtSignature ?? vertexMetadata?.thoughtSignature
		) === "string"
	) {
		metadata.thoughtSignature =
			googleMetadata?.thoughtSignature ?? vertexMetadata?.thoughtSignature;
	}
	if (
		typeof metadata.thought_signature !== "string" &&
		typeof googleMetadata?.thought_signature === "string"
	) {
		metadata.thought_signature = googleMetadata.thought_signature;
	}

	return Object.keys(metadata).length > 0 ? metadata : undefined;
}

/**
 * A stream error captured while the raw provider error object is still in
 * hand: the flattened display message plus its classification. Both are
 * derived here because the structure needed to classify does not survive
 * `extractErrorMessage`.
 */
interface CapturedStreamError {
	message: string;
	errorClass: ProviderErrorClass;
	/**
	 * This layer already recorded `sdk.error` telemetry for the failure.
	 * Forwarded as `errorReported` on the `finish` event so the agent loop
	 * does not report the same failure a second time.
	 */
	reported?: boolean;
}

function captureStreamError(error: unknown): CapturedStreamError {
	return {
		message: extractErrorMessage(error),
		errorClass: classifyProviderError(error),
	};
}

async function* emitAiSdkEvents(
	stream: AiSdkStreamResult,
	request: GatewayStreamRequest,
	context: GatewayProviderContext,
	pricingValue?: unknown,
	capturedError?: { current: CapturedStreamError | undefined },
	modelToolAdapters?: BuiltModelTools,
): AsyncIterable<AgentModelEvent> {
	let sawToolCalls = false;
	const emittedToolCallIds = new Set<string>();
	let finishReason: unknown;
	let streamError: CapturedStreamError | undefined;
	let finishUsage: unknown;
	let finishProviderMetadata: unknown;
	let streamAborted = false;
	let sawVisibleContent = false;
	const mediaBudget = createMediaBudgetState();
	const rejectedMediaErrors: string[] = [];
	const activeProjectedModelToolCalls = new Map<
		string,
		ActiveProjectedModelToolCall
	>();
	const projectedModelToolResults = new Map<string, ProjectedModelToolResult>();
	const pendingProjectedModelToolOutputs = new Map<string, unknown>();
	const projectedModelToolErrors = new Map<string, string>();
	// Tool calls the provider executed inside this inference request (e.g. the
	// Claude Code CLI's own tools). They surface as observational activity and
	// must never enter AgentRuntime's local execution/approval loop. Result and
	// error parts are matched by ID because some providers omit the
	// providerExecuted flag on the result half of the pair.
	const observationalProviderToolCallIds = new Set<string>();

	try {
		if (stream.fullStream) {
			for await (const part of stream.fullStream) {
				if (part.type === "text-delta") {
					const text =
						(part.textDelta as string | undefined) ??
						(part.text as string | undefined) ??
						(part.delta as string | undefined);
					if (text) {
						sawVisibleContent = true;
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
						sawVisibleContent = true;
						yield {
							type: "reasoning-delta",
							text,
							metadata: extractGoogleThoughtMetadata(part),
						};
					}
					continue;
				}

				if (part.type === "file") {
					const extracted = extractGeneratedImage(part.file, mediaBudget);
					if (extracted.kind === "accepted") {
						sawVisibleContent = true;
						yield {
							type: "media",
							media: toGeneratedImageMedia(extracted.image),
						};
						continue;
					}
					if (extracted.kind === "rejected") {
						rejectedMediaErrors.push(extracted.error.message);
						continue;
					}
					// Preserve non-image model files on the generic event path.
					const file = part.file as
						| { base64?: string; mediaType?: string }
						| undefined;
					const data = file?.base64;
					if (typeof data === "string" && data.length > 0) {
						const mediaType = file?.mediaType ?? "application/octet-stream";
						const validation = validateAndReserveBase64Media(
							data,
							{},
							mediaBudget,
						);
						if (!validation.ok) {
							rejectedMediaErrors.push(validation.message);
							continue;
						}
						sawVisibleContent = true;
						yield {
							type: "media",
							media: {
								id: `media_${nanoid()}`,
								modality: generatedMediaModalityFromMediaType(mediaType),
								mediaType,
								source: { type: "base64", data: validation.base64 },
								sizeBytes: validation.decodedBytes,
							},
						};
					}
					continue;
				}

				if (part.type === "tool-call") {
					const toolName =
						(part.toolName as string | undefined) ??
						(part.name as string | undefined) ??
						"tool";
					// Provider-executed tools complete inside this inference request. They
					// must not enter AgentRuntime's local execution/approval loop. The same
					// applies to provider-defined client tools: streamText executes those
					// and continues the internal model step before returning control.
					const modelTool = request.modelTools?.find(
						(tool) => tool.name === toolName,
					);
					if (modelTool) {
						const explicitToolCallId =
							(part.toolCallId as string | undefined) ??
							(part.id as string | undefined);
						const adapter = modelToolAdapters?.[modelTool.name];
						if (adapter?.projectResult && !explicitToolCallId) {
							throw new Error(
								`Model tool "${modelTool.name}" call is missing a valid tool-call ID`,
							);
						}
						const toolCallId = explicitToolCallId ?? `model_tool_${nanoid()}`;
						const execution =
							part.providerExecuted === true ? "provider" : "client";
						if (adapter?.projectResult) {
							activeProjectedModelToolCalls.set(toolCallId, {
								toolName: modelTool.name,
								input: part.input ?? part.args,
								execution,
							});
						}
						yield {
							type: "tool-call-delta",
							toolCallId,
							toolName: modelTool.name,
							execution,
							input: part.input ?? part.args,
						};
						continue;
					}
					if (part.providerExecuted === true) {
						const toolCallId =
							(part.toolCallId as string | undefined) ??
							(part.id as string | undefined) ??
							`provider_tool_${nanoid()}`;
						observationalProviderToolCallIds.add(toolCallId);
						sawVisibleContent = true;
						yield {
							type: "tool-call-delta",
							toolCallId,
							toolName,
							execution: "provider",
							input: part.input ?? part.args,
						};
						continue;
					}
					sawToolCalls = true;
					sawVisibleContent = true;
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
						toolName,
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

				if (part.type === "tool-result") {
					const toolName =
						(part.toolName as string | undefined) ??
						(part.name as string | undefined) ??
						"tool";
					const modelTool = request.modelTools?.find(
						(tool) => tool.name === toolName,
					);
					if (modelTool) {
						const explicitToolCallId =
							(part.toolCallId as string | undefined) ??
							(part.id as string | undefined);
						const adapter = modelToolAdapters?.[modelTool.name];
						if (adapter?.projectResult && !explicitToolCallId) {
							throw new Error(
								`Model tool "${modelTool.name}" result is missing a valid tool-call ID`,
							);
						}
						const toolCallId = explicitToolCallId ?? `model_tool_${nanoid()}`;
						if (adapter?.projectResult) {
							if (part.preliminary !== true) {
								if (!activeProjectedModelToolCalls.has(toolCallId)) {
									throw new Error(
										`Model tool "${modelTool.name}" returned a result without a matching call`,
									);
								}
								// Provider SDKs can repeat a terminal tool result. Buffer the
								// latest value and validate it once so duplicates neither emit
								// duplicate media nor consume the aggregate media budget twice.
								pendingProjectedModelToolOutputs.set(
									toolCallId,
									part.output ?? part.result,
								);
								projectedModelToolErrors.delete(toolCallId);
							}
							continue;
						}
						if (part.preliminary !== true) {
							yield {
								type: "tool-result",
								toolCallId,
								toolName: modelTool.name,
								execution:
									part.providerExecuted === true ? "provider" : "client",
								input: part.input ?? part.args,
								output: part.output ?? part.result,
							};
						}
						continue;
					}
					const toolCallId =
						(part.toolCallId as string | undefined) ??
						(part.id as string | undefined);
					if (
						part.providerExecuted === true ||
						(toolCallId && observationalProviderToolCallIds.has(toolCallId))
					) {
						if (part.preliminary !== true) {
							sawVisibleContent = true;
							yield {
								type: "tool-result",
								toolCallId: toolCallId ?? `provider_tool_${nanoid()}`,
								toolName,
								execution: "provider",
								input: part.input ?? part.args,
								output: part.output ?? part.result,
							};
						}
						continue;
					}
				}

				if (part.type === "tool-error") {
					const toolName =
						(part.toolName as string | undefined) ??
						(part.name as string | undefined) ??
						"tool";
					const modelTool = request.modelTools?.find(
						(tool) => tool.name === toolName,
					);
					if (modelTool) {
						const explicitToolCallId =
							(part.toolCallId as string | undefined) ??
							(part.id as string | undefined);
						const adapter = modelToolAdapters?.[modelTool.name];
						if (adapter?.projectResult && !explicitToolCallId) {
							throw new Error(
								`Model tool "${modelTool.name}" error is missing a valid tool-call ID`,
							);
						}
						const toolCallId = explicitToolCallId ?? `model_tool_${nanoid()}`;
						if (adapter?.projectResult) {
							pendingProjectedModelToolOutputs.delete(toolCallId);
							projectedModelToolErrors.set(
								toolCallId,
								`Model tool "${modelTool.name}" failed: ${extractErrorMessage(part.error)}`,
							);
							continue;
						}
						yield {
							type: "tool-result",
							toolCallId,
							toolName: modelTool.name,
							execution: part.providerExecuted === true ? "provider" : "client",
							input: part.input ?? part.args,
							output: { error: extractErrorMessage(part.error) },
							isError: true,
						};
						continue;
					}
					{
						const errorToolCallId =
							(part.toolCallId as string | undefined) ??
							(part.id as string | undefined);
						if (
							part.providerExecuted === true ||
							(errorToolCallId &&
								observationalProviderToolCallIds.has(errorToolCallId))
						) {
							yield {
								type: "tool-result",
								toolCallId: errorToolCallId ?? `provider_tool_${nanoid()}`,
								toolName,
								execution: "provider",
								input: part.input ?? part.args,
								output: { error: extractErrorMessage(part.error) },
								isError: true,
							};
							continue;
						}
					}
					sawToolCalls = true;
					const toolCallId =
						(part.toolCallId as string | undefined) ??
						(part.id as string | undefined) ??
						`tool_${nanoid()}`;
					const alreadyEmitted = emittedToolCallIds.has(toolCallId);
					emittedToolCallIds.add(toolCallId);
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
						capturedError?.current ?? captureStreamError(part.error);
					break;
				}

				if (part.type === "abort") {
					streamAborted = true;
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
		streamError = capturedError?.current ?? captureStreamError(error);
	}

	if (!streamError) {
		for (const [toolCallId, output] of pendingProjectedModelToolOutputs) {
			const active = activeProjectedModelToolCalls.get(toolCallId);
			const adapter = active ? modelToolAdapters?.[active.toolName] : undefined;
			if (!active || !adapter?.projectResult) continue;
			try {
				const projection = adapter.projectResult(output);
				const media: GeneratedMedia[] = [];
				const errors: string[] = [];
				for (const candidate of projection.media) {
					const normalized = normalizeProjectedModelToolMedia(
						candidate,
						mediaBudget,
					);
					if (normalized.ok) media.push(normalized.media);
					else errors.push(normalized.error);
				}
				if (media.length === 0) {
					projectedModelToolErrors.set(
						toolCallId,
						errors[0] ??
							`Model tool "${active.toolName}" returned no supported media`,
					);
					continue;
				}
				projectedModelToolResults.set(toolCallId, {
					media,
					activityOutput:
						projection.activityOutput ?? summarizeProjectedMedia(media),
				});
				projectedModelToolErrors.delete(toolCallId);
			} catch (error) {
				projectedModelToolErrors.set(toolCallId, extractErrorMessage(error));
			}
		}
	}

	if (!streamError && !streamAborted) {
		for (const toolCallId of activeProjectedModelToolCalls.keys()) {
			if (
				!projectedModelToolResults.has(toolCallId) &&
				!projectedModelToolErrors.has(toolCallId)
			) {
				const active = activeProjectedModelToolCalls.get(toolCallId);
				projectedModelToolErrors.set(
					toolCallId,
					`Model tool "${active?.toolName ?? "unknown"}" completed without a final result`,
				);
			}
		}
	}

	if (!streamError) {
		for (const [toolCallId, projection] of projectedModelToolResults) {
			const active = activeProjectedModelToolCalls.get(toolCallId);
			if (!active) continue;
			sawVisibleContent = true;
			for (const media of projection.media) {
				yield { type: "media", media };
			}
			yield {
				type: "tool-result",
				toolCallId,
				toolName: active.toolName,
				execution: active.execution,
				input: active.input,
				output: projection.activityOutput,
			};
		}
		for (const [toolCallId, error] of projectedModelToolErrors) {
			const active = activeProjectedModelToolCalls.get(toolCallId);
			if (!active) continue;
			yield {
				type: "tool-result",
				toolCallId,
				toolName: active.toolName,
				execution: active.execution,
				input: active.input,
				output: { error },
				isError: true,
			};
		}
		if (
			!sawVisibleContent &&
			(projectedModelToolErrors.size > 0 || rejectedMediaErrors.length > 0)
		) {
			streamError = captureStreamError(
				new Error(
					projectedModelToolErrors.values().next().value ??
						rejectedMediaErrors[0] ??
						"Model returned no supported media",
				),
			);
		}
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
				streamError = capturedError?.current ?? captureStreamError(error);
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
		error: streamError?.message,
		errorClass: streamError?.errorClass,
		errorReported: streamError?.reported,
	};
}

async function createProviderModule(
	kind: ProviderModuleKind,
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	switch (kind) {
		case "cline": {
			const { createClineProviderModule } = await import("./vendors/cline");
			return createClineProviderModule(config, context);
		}
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
		case "ollama": {
			const { createOllamaProviderModule } = await import("./vendors/ollama");
			return createOllamaProviderModule(config, context);
		}
		case "sapaicore": {
			const { createSapAiCoreProviderModule } = await import(
				"./vendors/community"
			);
			return createSapAiCoreProviderModule(config);
		}
	}
}

/**
 * Wrap a vendor-constructed model with the transient-failure retry
 * middleware (empty responses + pre-content network interruptions).
 *
 * All-empty turns (no text, no reasoning, no tool call) are a cross-provider
 * phenomenon: production telemetry shows them on hosted backends (openrouter,
 * cline, generic OpenAI-compatible endpoints), not just local Ollama. An
 * empty assistant turn is a hard failure in the agent runtime ("Model
 * returned empty response"), so a single transient flake kills the task.
 * The same telemetry shows mid-stream network deaths (UND_ERR_SOCKET,
 * body/headers timeouts, ECONNRESET) as the dominant network-class run
 * killer — the AI SDK's own retry covers only request initiation, so once a
 * stream has started nothing else retries. Retrying here — the one
 * composition point every AI SDK vendor flows through — turns those flakes
 * into non-events while leaving the runtime's loud failure in place for
 * models that are persistently empty or connections that are truly down.
 *
 * Applied as the *outermost* wrap so each retry re-runs the vendor's full
 * request pipeline, including any vendor-level middleware attached inside
 * `provider.operations.language(...)`. Vendors opt out or tune attempts through
 * `ProviderFactoryResult.retryEmptyResponses`.
 */
export function withEmptyResponseRetry(
	model: unknown,
	retryEmptyResponses: ProviderFactoryResult["retryEmptyResponses"],
	logger: GatewayProviderContext["logger"],
): unknown {
	if (retryEmptyResponses === false) {
		return model;
	}
	return wrapLanguageModel({
		model: model as LanguageModelV4,
		middleware: createRetryEmptyResponseMiddleware({
			...retryEmptyResponses,
			logger,
		}),
	});
}

function createAiSdkProvider(kind: ProviderModuleKind): GatewayProviderFactory {
	return async (config) => ({
		async *stream(request, context) {
			const log = context.logger;
			let stream: AiSdkStreamResult | undefined;
			const capturedError: { current: CapturedStreamError | undefined } = {
				current: undefined,
			};
			try {
				const provider = await createProviderModule(
					kind,
					{
						...config,
						fetch: wrapFetchForStickySession(
							wrapFetchForProviderRequestCapture(config.fetch, request),
							request,
							context,
						),
					},
					context,
				);
				const composedProviderOptions = composeAiSdkProviderOptions(
					request,
					context,
					kind,
				);
				const googleImageProviderKey =
					kind === "google"
						? "google"
						: kind === "vertex"
							? "vertex"
							: undefined;
				const providerOptions =
					context.provider.metadata?.imageTransport === "openrouter" &&
					modelProducesImages(context.model)
						? {
								...composedProviderOptions,
								openrouter: {
									...((composedProviderOptions[
										request.providerId as keyof typeof composedProviderOptions
									] ??
										composedProviderOptions.openaiCompatible ??
										{}) as Record<string, unknown>),
									// OpenRouter-compatible image generation uses chat
									// completions under the hood and requires explicit output
									// modalities.
									modalities: ["image", "text"],
								},
							}
						: googleImageProviderKey !== undefined &&
								modelProducesImages(context.model) &&
								!usesImageGenerationOperation(context.model)
							? {
									...composedProviderOptions,
									[googleImageProviderKey]: {
										...((composedProviderOptions[googleImageProviderKey] ??
											{}) as Record<string, unknown>),
										responseModalities: ["TEXT", "IMAGE"],
									},
								}
							: composedProviderOptions;
				const modelOperation = context.model.operation ?? "language";
				if (
					modelOperation !== "language" &&
					modelOperation !== "image-generation"
				) {
					throw new Error(
						`Provider "${context.provider.id}" does not implement the "${modelOperation}" model operation`,
					);
				}
				if (usesImageGenerationOperation(context.model)) {
					if (!provider.operations.imageGeneration) {
						throw new Error(
							`Provider "${context.provider.id}" does not support image generation models`,
						);
					}
					const prompt = resolveImageGenerationPrompt(request, context);
					recordProviderRequestCapture({
						stage: "ai_sdk_prompt",
						request,
						payload: {
							operation: "generate_image",
							prompt:
								typeof prompt === "string"
									? prompt
									: {
											text: prompt.text,
											imageCount: prompt.images.length,
										},
							providerOptions,
						},
					});
					const result = await generateImage({
						model: provider.operations.imageGeneration(
							context.model.id,
						) as never,
						prompt,
						abortSignal: request.signal,
						providerOptions: providerOptions as never,
					});
					let emittedImages = 0;
					let rejectedImageError: string | undefined;
					const mediaBudget = createMediaBudgetState();
					for (const file of result.images) {
						const extracted = extractGeneratedImage(file, mediaBudget);
						if (extracted.kind === "rejected") {
							rejectedImageError = extracted.error.message;
							continue;
						}
						if (extracted.kind !== "accepted") continue;
						emittedImages += 1;
						yield {
							type: "media",
							media: toGeneratedImageMedia(extracted.image),
						};
					}
					if (emittedImages === 0) {
						throw new Error(
							rejectedImageError ?? "Image model returned no supported images",
						);
					}
					if (result.usage) {
						yield {
							type: "usage",
							usage: normalizeUsage(
								result.usage as Record<string, unknown>,
								result.providerMetadata,
								context.model.metadata?.pricing,
							),
						};
					}
					yield { type: "finish", reason: "stop" };
					return;
				}
				const langfuse = await ensureGatewayLangfuseTelemetry(
					config.providerId,
				);
				const externalToolExecutionDisabled =
					providerDisablesExternalToolExecution(context);
				const toolCallingDisabled =
					externalToolExecutionDisabled ||
					!modelSupportsToolCalling(context.model);
				const runtimeTools = toolCallingDisabled
					? undefined
					: toAiSdkTools(request);
				const activeModelTools = toolCallingDisabled
					? []
					: (request.modelTools ?? []).filter(
							(tool) => !hasAiSdkTool(runtimeTools, tool.name),
						);
				const modelToolRequest = {
					...request,
					modelTools: activeModelTools,
				};
				const modelToolAdapters = buildProviderModelTools(
					provider,
					modelToolRequest,
					context,
				);
				const modelTools = toAiSdkModelToolSet(modelToolAdapters);
				const tools = mergeAiSdkTools(runtimeTools, modelTools);
				const systemPrompt = resolveAiSdkSystemPrompt(request);
				const useSystemOption =
					typeof systemPrompt === "string" && systemPrompt.trim().length > 0;
				const messagesSystemPrompt = useSystemOption ? undefined : systemPrompt;
				const messages = buildAiSdkRequestMessages(
					request,
					context,
					messagesSystemPrompt,
				);
				const portableReasoning = resolvePortableReasoning(request);
				const requestConfig = provider.buildStreamConfig
					? provider.buildStreamConfig(request, context)
					: buildAiSdkStreamConfig(request, context);
				recordProviderRequestCapture({
					stage: "ai_sdk_prompt",
					request,
					payload: {
						messages,
						...(useSystemOption ? { system: systemPrompt } : {}),
						tools,
						providerOptions,
						...requestConfig,
						...(portableReasoning ? { reasoning: portableReasoning } : {}),
					},
				});
				stream = await withAiSdkLangfuseTraceContext(
					langfuse,
					request,
					() =>
						streamText({
							model: withEmptyResponseRetry(
								provider.operations.language(context.model.id),
								provider.retryEmptyResponses,
								context.logger,
							) as never,
							messages: messages as never,
							...(useSystemOption ? { system: systemPrompt } : {}),
							...(tools ? { tools } : {}),
							abortSignal: request.signal,
							experimental_repairToolCall: repairMalformedToolCall as never,
							telemetry: {
								isEnabled: langfuse,
								functionId: "cline-agent-turn",
								includeRuntimeContext: {
									distinctId: true,
									userId: true,
									sessionId: true,
									clientName: true,
									clientVersion: true,
									clineCoreVersion: true,
									tags: true,
									conversationId: true,
									runId: true,
									iteration: true,
									providerId: true,
									modelId: true,
									resolvedModelId: true,
								},
							},
							runtimeContext: buildAiSdkRuntimeContext(request, context),
							providerOptions: providerOptions as never,
							...(provider.executesModelTools && activeModelTools.length
								? { stopWhen: stepCountIs(8) }
								: {}),
							...requestConfig,
							...(portableReasoning ? { reasoning: portableReasoning } : {}),
							onError: ({ error: streamError }) => {
								const captured = captureStreamError(streamError);
								const msg = captured.message;
								capturedError.current = captured;
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
								captured.reported = captureSdkError(context.telemetry, {
									component: "llms",
									operation: "provider.stream",
									error: streamError,
									errorMessage: msg,
									severity: "error",
									handled: true,
									context: {
										providerId: request.providerId,
										modelId: request.modelId,
										providerKind: kind,
									},
								});
							},
						}) as unknown as AiSdkStreamResult,
				);

				// Suppress dangling promise rejections (finishReason, totalUsage, steps, etc.)
				// BEFORE iterating. The AI SDK rejects these DelayedPromises inside the stream's
				// flush callback, which runs during iteration, so we must attach .catch() handlers
				// upfront or Bun/Node will surface them as unhandled rejections.
				suppressDanglingStreamPromises(stream);

				yield* emitAiSdkEvents(
					stream,
					modelToolRequest,
					context,
					context.model.metadata?.pricing,
					capturedError,
					modelToolAdapters,
				);
			} catch (error) {
				suppressDanglingStreamPromises(stream);
				// Prefer the real provider error captured in onError over the generic
				// NoOutputGeneratedError that the AI SDK throws when 0 steps are recorded.
				const captured = capturedError.current ?? captureStreamError(error);
				const msg = captured.message;
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
				const reported = captureSdkError(context.telemetry, {
					component: "llms",
					operation: "provider.create_or_stream",
					error,
					errorMessage: msg,
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
					errorClass: captured.errorClass,
					errorReported: reported || captured.reported,
				};
			}
		},
	});
}

export const createOpenAIProvider = createAiSdkProvider("openai");
export const createClineProvider = createAiSdkProvider("cline");
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
export const createOllamaProvider = createAiSdkProvider("ollama");
export const createSapAiCoreProvider = createAiSdkProvider("sapaicore");
