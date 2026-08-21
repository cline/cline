import type { AgentUsage, GeneratedMedia } from "@cline/shared";
import {
	type ApiStreamChunk,
	createHandlerAsync,
	type ProviderConfig,
} from "./providers";

type ApiStreamUsageChunk = Extract<ApiStreamChunk, { type: "usage" }>;
type ApiStreamDoneChunk = Extract<ApiStreamChunk, { type: "done" }>;

/** A provider-neutral media generation request. */
export interface MediaGenerationRequest {
	providerConfig: ProviderConfig;
	modelId: string;
	prompt: string;
	/** The requested output modality. Image is the first supported modality. */
	mediaType: "image";
	abortSignal?: AbortSignal;
}

/** Canonical media and provider-reported usage from one generation request. */
export interface MediaGenerationResult {
	media: GeneratedMedia[];
	usage?: AgentUsage;
}

/**
 * A media generation failure raised after the provider request ran. Carries
 * any provider-reported usage so callers can still record token and cost
 * totals for the failed generation.
 */
export class MediaGenerationError extends Error {
	readonly usage?: AgentUsage;

	constructor(message: string, options?: { usage?: AgentUsage }) {
		super(message);
		this.name = "MediaGenerationError";
		this.usage = options?.usage;
	}
}

function resolveAbortSignal(
	config: ProviderConfig,
	requestSignal: AbortSignal | undefined,
): AbortSignal | undefined {
	const signals = [requestSignal, config.abortSignal].filter(
		(signal): signal is AbortSignal => signal !== undefined,
	);
	if (
		typeof config.timeoutMs === "number" &&
		Number.isFinite(config.timeoutMs) &&
		config.timeoutMs > 0
	) {
		signals.push(AbortSignal.timeout(Math.floor(config.timeoutMs)));
	}
	if (signals.length === 0) return undefined;
	return signals.length === 1 ? signals[0] : AbortSignal.any(signals);
}

function toUsage(chunk: ApiStreamUsageChunk): AgentUsage {
	return {
		inputTokens: chunk.inputTokens,
		outputTokens: chunk.outputTokens,
		cacheReadTokens: chunk.cacheReadTokens ?? 0,
		cacheWriteTokens: chunk.cacheWriteTokens ?? 0,
		...(chunk.thoughtsTokenCount !== undefined
			? { reasoningTokenCount: chunk.thoughtsTokenCount }
			: {}),
		...(chunk.totalCost !== undefined ? { totalCost: chunk.totalCost } : {}),
	};
}

function unsuccessfulDoneError(
	chunk: ApiStreamDoneChunk,
	usage: AgentUsage | undefined,
): MediaGenerationError {
	const detail = chunk.error?.trim() || chunk.incompleteReason?.trim();
	return new MediaGenerationError(
		detail ? `Media generation failed: ${detail}` : "Media generation failed",
		{ usage },
	);
}

/**
 * Generate media with the same provider registry and gateway path used by chat.
 *
 * This intentionally does not enable provider-native model tools such as
 * `image_generation`: the selected model itself performs the media-generation
 * operation and its output is collected from canonical `media` stream chunks.
 */
export async function generateMedia(
	request: MediaGenerationRequest,
): Promise<MediaGenerationResult> {
	const modelId = request.modelId.trim();
	if (!modelId) {
		throw new Error("Media generation model is required");
	}
	const prompt = request.prompt.trim();
	if (!prompt) {
		throw new Error("Media generation prompt is required");
	}

	const abortSignal = resolveAbortSignal(
		request.providerConfig,
		request.abortSignal,
	);
	abortSignal?.throwIfAborted();

	const configuredModelInfo =
		request.providerConfig.modelInfo?.id === modelId
			? request.providerConfig.modelInfo
			: request.providerConfig.knownModels?.[modelId];
	const providerConfig: ProviderConfig = {
		...request.providerConfig,
		modelId,
		modelInfo: configuredModelInfo,
		abortSignal,
		// Reasoning controls belong to the provider's selected chat model. A
		// separately selected media model can support a different effort set (or
		// no reasoning controls at all), so carrying those settings across makes
		// otherwise valid image requests fail before generation starts.
		thinking: undefined,
		reasoningEffort: undefined,
		thinkingBudgetTokens: undefined,
	};
	const handler = await createHandlerAsync(providerConfig);
	abortSignal?.throwIfAborted();
	handler.setAbortSignal?.(abortSignal);

	const media: GeneratedMedia[] = [];
	let usage: AgentUsage | undefined;
	for await (const chunk of handler.createMessage("", [
		{ role: "user", content: prompt },
	])) {
		abortSignal?.throwIfAborted();
		switch (chunk.type) {
			case "media":
				if (chunk.media.modality === request.mediaType) {
					media.push(chunk.media);
				}
				break;
			case "usage":
				usage = toUsage(chunk);
				break;
			case "done":
				if (!chunk.success) {
					throw unsuccessfulDoneError(chunk, usage);
				}
				break;
		}
	}

	abortSignal?.throwIfAborted();
	if (media.length === 0) {
		throw new MediaGenerationError(
			`Media generation returned no ${request.mediaType} media`,
			{ usage },
		);
	}
	return { media, ...(usage ? { usage } : {}) };
}
