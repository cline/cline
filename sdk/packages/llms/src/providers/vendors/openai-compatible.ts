import { createGateway } from "@ai-sdk/gateway";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { isImageGenerationModel } from "@cline/shared";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { wrapLanguageModel } from "ai";
import { ensureFetch, resolveApiKey } from "../http";
import { splitToolImagesMiddleware } from "../middleware/split-tool-images";
import { isOpenAIReasoningEraModelId } from "../model-facts";
import type { ProviderFactoryResult } from "./types";

type FetchInput = Parameters<typeof fetch>[0];
type FetchWithOptionalPreconnect = typeof fetch & {
	preconnect?: (...args: unknown[]) => unknown;
};

function readAzureApiVersion(
	config: GatewayResolvedProviderConfig,
): string | undefined {
	const apiVersion = config.options?.apiVersion;
	if (typeof apiVersion !== "string") {
		return undefined;
	}
	const trimmed = apiVersion.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function shouldAddAzureApiVersion(url: URL): boolean {
	return (
		url.pathname.startsWith("/openai/deployments/") &&
		!url.searchParams.has("api-version")
	);
}

function withAzureApiVersion(
	input: FetchInput,
	apiVersion: string,
): FetchInput {
	let url: URL;
	try {
		url = new URL(input instanceof Request ? input.url : input.toString());
	} catch {
		return input;
	}
	if (!shouldAddAzureApiVersion(url)) {
		return input;
	}
	url.searchParams.set("api-version", apiVersion);
	if (input instanceof Request) {
		return new Request(url.toString(), input);
	}
	return (typeof input === "string" ? url.toString() : url) as FetchInput;
}

function createAzureApiVersionFetch(
	config: GatewayResolvedProviderConfig,
): typeof fetch | undefined {
	const apiVersion = readAzureApiVersion(config);
	if (!apiVersion) {
		return config.fetch;
	}
	const baseFetch = config.fetch ?? globalThis.fetch;
	if (!baseFetch) {
		return config.fetch;
	}
	const azureFetch = ((input, init) =>
		baseFetch(withAzureApiVersion(input, apiVersion), init)) as typeof fetch;
	const baseFetchWithPreconnect = baseFetch as FetchWithOptionalPreconnect;
	(azureFetch as FetchWithOptionalPreconnect).preconnect =
		typeof baseFetchWithPreconnect.preconnect === "function"
			? baseFetchWithPreconnect.preconnect.bind(baseFetch)
			: () => undefined;
	return azureFetch;
}

type ResponseErrorHandler = (response: Response) => Promise<void> | void;

function resolveVercelGatewayImageBaseUrl(
	baseUrl: string | undefined,
): string | undefined {
	if (!baseUrl) return undefined;
	try {
		const url = new URL(baseUrl);
		if (
			url.hostname === "ai-gateway.vercel.sh" &&
			url.pathname.replace(/\/+$/, "") === "/v1"
		) {
			// The provider's generic OpenAI-compatible endpoint is not the AI SDK
			// Gateway endpoint. Let @ai-sdk/gateway select its current versioned
			// `/ai` base instead of producing `/v1/image-model`.
			return undefined;
		}
		return url.toString().replace(/\/+$/, "");
	} catch {
		return baseUrl;
	}
}

function readResponseErrorHandler(
	config: GatewayResolvedProviderConfig,
): ResponseErrorHandler | undefined {
	const handler = config.options?.onResponseError;
	return typeof handler === "function"
		? (handler as ResponseErrorHandler)
		: undefined;
}

function createResponseErrorFetch(input: {
	fetch: typeof fetch;
	onResponseError: ResponseErrorHandler;
}): typeof fetch {
	const responseErrorFetch = (async (requestInput, init) => {
		const response = await input.fetch(requestInput, init);

		await input.onResponseError(response);

		return response;
	}) as typeof fetch;

	const baseFetchWithPreconnect = input.fetch as FetchWithOptionalPreconnect;
	(responseErrorFetch as FetchWithOptionalPreconnect).preconnect =
		typeof baseFetchWithPreconnect.preconnect === "function"
			? baseFetchWithPreconnect.preconnect.bind(input.fetch)
			: () => undefined;
	return responseErrorFetch;
}

/**
 * OpenAI's chat-completions API rejects `max_tokens` for reasoning-era
 * models ("Unsupported parameter: 'max_tokens' is not supported with this
 * model. Use 'max_completion_tokens' instead."). Rename the parameter only
 * for model ids that require it: OpenAI, Azure OpenAI, and the major
 * OpenAI-compatible gateways (OpenRouter, LiteLLM) all accept
 * `max_completion_tokens`, while older third-party servers that only know
 * `max_tokens` do not serve o-series/gpt-5 model ids — so every other
 * request keeps its exact current wire format.
 */
export function withMaxCompletionTokensForReasoningModels(
	body: Record<string, unknown>,
): Record<string, unknown> {
	const { max_tokens: maxTokens, ...rest } = body;
	if (
		maxTokens == null ||
		typeof body.model !== "string" ||
		!isOpenAIReasoningEraModelId(body.model)
	) {
		return body;
	}
	return {
		...rest,
		// Keep an explicit `max_completion_tokens` passed via provider
		// options passthrough if one is already present.
		max_completion_tokens: rest.max_completion_tokens ?? maxTokens,
	};
}

function createSuccessDataResponseFetch(baseFetch: typeof fetch): typeof fetch {
	const responseEnvelopeFetch = (async (requestInput, init) => {
		const response = await baseFetch(requestInput, init);
		if (!response.ok) return response;

		const text = await response.text();
		let unwrapped = text;
		let responseContentType = response.headers.get("content-type");
		try {
			let payload = JSON.parse(text) as unknown;
			if (
				payload &&
				typeof payload === "object" &&
				!Array.isArray(payload) &&
				"success" in payload &&
				payload.success === true &&
				"data" in payload
			) {
				payload = payload.data;
				unwrapped = JSON.stringify(payload);
			}

			// Cline's OpenRouter transport can return a completed chat response
			// even when the AI SDK requested a stream. Project that response onto
			// the standard OpenAI-compatible event stream so the v4 provider
			// emits text, files, tools, usage, and finish metadata normally.
			const completionCandidate =
				payload && typeof payload === "object" && !Array.isArray(payload)
					? (payload as Record<string, unknown>)
					: undefined;
			const completionChoices = completionCandidate?.choices;
			if (
				completionCandidate &&
				Array.isArray(completionChoices) &&
				completionChoices.some(
					(choice: unknown) =>
						choice !== null &&
						typeof choice === "object" &&
						!Array.isArray(choice) &&
						"message" in choice,
				)
			) {
				const completion = completionCandidate;
				const choices = (completion.choices as unknown[]).map((choice) => {
					if (
						choice === null ||
						typeof choice !== "object" ||
						Array.isArray(choice)
					) {
						return choice;
					}
					const { message, ...rest } = choice as Record<string, unknown>;
					return {
						...rest,
						delta:
							message !== null &&
							typeof message === "object" &&
							!Array.isArray(message)
								? message
								: {},
					};
				});
				unwrapped = `data: ${JSON.stringify({
					...completion,
					choices,
				})}\n\ndata: [DONE]\n\n`;
				responseContentType = "text/event-stream";
			}
		} catch {
			// Recreate the original response below so consuming it for envelope
			// detection never changes provider behavior.
		}

		const headers = new Headers(response.headers);
		if (responseContentType) {
			headers.set("content-type", responseContentType);
		}
		headers.delete("content-encoding");
		headers.delete("content-length");
		return new Response(unwrapped, {
			status: response.status,
			statusText: response.statusText,
			headers,
		});
	}) as typeof fetch;

	const baseFetchWithPreconnect = baseFetch as FetchWithOptionalPreconnect;
	(responseEnvelopeFetch as FetchWithOptionalPreconnect).preconnect =
		typeof baseFetchWithPreconnect.preconnect === "function"
			? baseFetchWithPreconnect.preconnect.bind(baseFetch)
			: () => undefined;
	return responseEnvelopeFetch;
}

export async function createOpenAICompatibleProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	// Don't preflight-check for a missing API key. If credentials are
	// missing or wrong, the provider's own response (e.g. 401) is the
	// authoritative error and is surfaced to the user as-is. This keeps
	// `llms` unopinionated about which providers do or don't need a key.
	const apiKey = await resolveApiKey(config);
	const fetch = createAzureApiVersionFetch(config);
	const onResponseError = readResponseErrorHandler(config);
	const providerFetch = onResponseError
		? createResponseErrorFetch({
				fetch: ensureFetch(fetch),
				onResponseError,
			})
		: fetch;
	const provider = createOpenAICompatible({
		name: context.provider.id,
		apiKey,
		...(config.baseUrl ? { baseURL: config.baseUrl } : {}),
		...(config.headers ? { headers: config.headers } : {}),
		...(providerFetch ? { fetch: providerFetch } : {}),
		includeUsage: true,
		transformRequestBody: withMaxCompletionTokensForReasoningModels,
	} as never);
	const useOpenRouterImageTransport =
		context.provider.metadata?.imageTransport === "openrouter" &&
		isImageGenerationModel(context.model);
	const openRouterFetch =
		context.provider.metadata?.responseEnvelope === "success-data"
			? createSuccessDataResponseFetch(ensureFetch(providerFetch))
			: providerFetch;
	const openRouterImageProvider = useOpenRouterImageTransport
		? createOpenRouter({
				apiKey,
				baseURL: config.baseUrl,
				headers: config.headers,
				fetch: openRouterFetch,
				compatibility:
					context.provider.id === "openrouter" ? "strict" : "compatible",
			})
		: undefined;
	const vercelGateway =
		context.provider.id === "vercel-ai-gateway"
			? createGateway({
					apiKey,
					baseURL: resolveVercelGatewayImageBaseUrl(config.baseUrl),
					headers: config.headers,
					fetch: providerFetch,
				})
			: undefined;
	return {
		// Wrap each constructed model with `splitToolImagesMiddleware` so
		// `role:"tool"` messages whose `output.type === 'content'` carries
		// image-data parts get split into a placeholder text + a synthetic
		// `role:"user"` message carrying the images. The OpenAI Chat
		// Completions wire format does NOT support multimodal tool messages
		// (the `@ai-sdk/openai-compatible` chat-messages converter
		// `JSON.stringify`s the parts array, losing image bytes). The
		// middleware operates on the typed `LanguageModelV4Prompt` BEFORE
		// the converter runs, so the converter sees only text-only tool
		// messages with adjacent multimodal user messages — the wire
		// pattern that classic Cline used in production for years (see
		// `convertToOpenAiMessages` in `src/core/api/transform/openai-format.ts`
		// on origin/main).
		model: (modelId) =>
			wrapLanguageModel({
				model: (openRouterImageProvider?.chat(modelId) ??
					provider(modelId)) as LanguageModelV4,
				middleware: splitToolImagesMiddleware,
			}),
		imageModel: (modelId) =>
			vercelGateway
				? vercelGateway.imageModel(modelId)
				: openRouterImageProvider
					? openRouterImageProvider.imageModel(modelId)
					: provider.imageModel(modelId),
	};
}
