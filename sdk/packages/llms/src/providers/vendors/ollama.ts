// Ollama vendor backed by the native Ollama API (`/api/chat`) via the
// `ollama-ai-provider-v2` AI SDK provider.
//
// Ollama cannot be driven through the generic OpenAI-compatible path
// (`/v1/chat/completions`): that endpoint ignores Ollama's proprietary
// `options.num_ctx` field, so every model loads with the server default
// context window (4096) regardless of the model's actual capacity or the
// user's configured context size. The native API accepts
// `options.num_ctx` per request; this boundary maps the provider-neutral
// model `contextWindow` onto it.

import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { wrapLanguageModel } from "ai";
// The installed package is patched (see
// `patches/ollama-ai-provider-v2@4.0.1.patch`) to preserve four native wire
// contracts the upstream 4.0.1 release breaks: an unset `think` must be
// omitted rather than sent as `false`, mid-stream `{"error": ...}` objects
// must surface as stream errors instead of being dropped before a clean
// finish, attachment-only user turns must send string `content` (not `[]`),
// and tool results must carry the documented `tool_name` field.
// `ollama.wire.test.ts` locks each contract at the real provider boundary;
// drop the patch once an upstream release covers them.
import { createOllama } from "ollama-ai-provider-v2";
import { ensureFetch, resolveApiKey } from "../http";
import { splitToolImagesMiddleware } from "../middleware/split-tool-images";
import {
	DEFAULT_INFERENCE_TIMEOUT_MS,
	readInferenceTimeoutMs,
	withInferenceTimeout,
} from "../streaming-fetch";
import type { ProviderFactoryResult } from "./types";

/**
 * Normalize a configured base URL to the native Ollama API root expected by
 * the provider (it appends endpoint paths such as `/chat`).
 *
 * Users configure hosts like `http://localhost:11434` or
 * `https://ollama.com`; configs saved by the 4.0.0 OpenAI-compatible
 * routing may carry a `/v1` suffix, and native-API configs an `/api` one.
 */
export function normalizeOllamaBaseUrl(
	baseUrl: string | undefined,
): string | undefined {
	const trimmed = baseUrl?.trim().replace(/\/+$/, "");
	if (!trimmed) {
		return undefined;
	}
	return `${trimmed.replace(/\/(?:v1|api)$/, "")}/api`;
}

/** Startup/inactivity budget for large local models; active streams may run longer. */
export const OLLAMA_DEFAULT_TIMEOUT_MS = DEFAULT_INFERENCE_TIMEOUT_MS;

export function readOllamaTimeoutMs(
	config: GatewayResolvedProviderConfig,
): number {
	return readInferenceTimeoutMs(config.timeoutMs);
}

export function withOllamaResponseTimeout(
	baseFetch: typeof fetch,
	timeoutMs: number,
): typeof fetch {
	return withInferenceTimeout(baseFetch, timeoutMs, "Ollama request");
}

export async function createOllamaProviderModule(
	config: GatewayResolvedProviderConfig,
	_context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	// An API key is only needed for Ollama Cloud (ollama.com); local servers
	// accept unauthenticated requests, so a missing key is not an error.
	// The provider accepts auth through headers. An explicit configured header
	// wins over the convenience API-key setting.
	const apiKey = await resolveApiKey(config);
	const baseURL = normalizeOllamaBaseUrl(config.baseUrl);
	const headers = {
		...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
		...config.headers,
	};
	const provider = createOllama({
		...(baseURL ? { baseURL } : {}),
		...(Object.keys(headers).length > 0 ? { headers } : {}),
		compatibility: "strict",
		fetch: withOllamaResponseTimeout(
			ensureFetch(config.fetch),
			readOllamaTimeoutMs(config),
		),
	});
	// Empty-response retries (a common local-backend glitch that otherwise
	// hard-fails the task) are applied centrally in `ai-sdk.ts` for every
	// vendor (see `withEmptyResponseRetry`), wrapped outside this model so
	// each retry re-runs the whole request. `splitToolImagesMiddleware` is
	// attached here, for the same reason as the OpenAI-compatible vendor:
	// the downstream converter stringifies multimodal tool-result content,
	// losing image bytes.
	return {
		operations: {
			language: (modelId) =>
				wrapLanguageModel({
					model: provider.chat(modelId),
					middleware: splitToolImagesMiddleware,
				}),
		},
	};
}
