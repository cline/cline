// Ollama vendor backed by the native Ollama API (`/api/chat`) via the
// `ai-sdk-ollama` AI SDK provider (which wraps the official `ollama` client).
//
// Ollama cannot be driven through the generic OpenAI-compatible path
// (`/v1/chat/completions`): that endpoint ignores Ollama's proprietary
// `options.num_ctx` field, so every model loads with the server default
// context window (4096) regardless of the model's actual capacity or the
// user's configured context size. The native API accepts
// `options.num_ctx` per request; this boundary maps the provider-neutral
// model `contextWindow` onto it.

import type { LanguageModelV3 } from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { wrapLanguageModel } from "ai";
import { createOllama } from "ai-sdk-ollama";
import { OLLAMA_DEFAULT_CONTEXT_WINDOW } from "../builtins";
import { ensureFetch, resolveApiKey } from "../http";
import { splitToolImagesMiddleware } from "../middleware/split-tool-images";
import type { ProviderFactoryResult } from "./types";

/** See {@link OLLAMA_DEFAULT_CONTEXT_WINDOW} — re-exported under the wire-format name. */
export const OLLAMA_DEFAULT_NUM_CTX = OLLAMA_DEFAULT_CONTEXT_WINDOW;

/**
 * Normalize a configured base URL to the origin the `ollama` client expects
 * as its `host` (the client appends `/api/...` itself).
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
	return trimmed.replace(/\/(?:v1|api)$/, "");
}

/**
 * Resolve the `num_ctx` to request from the resolved model's context window.
 * `num_ctx` stays an Ollama wire-format detail: callers express intent through
 * the provider-neutral model `contextWindow` (from the model catalog or the
 * user's configured context window), and this boundary maps it onto the wire.
 */
export function readOllamaNumCtx(context: GatewayProviderContext): number {
	const value = context.model?.contextWindow ?? context.model?.maxInputTokens;
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	return OLLAMA_DEFAULT_NUM_CTX;
}

/**
 * See {@link OLLAMA_DEFAULT_TIMEOUT_MS} in `../builtins` — re-exported so
 * existing importers keep working. The response-start timeout itself is now
 * applied for every provider by the shared AI SDK stream path (see
 * `withResponseStartTimeout` in `../http`); Ollama only keeps its tighter
 * legacy default.
 */
export { OLLAMA_DEFAULT_TIMEOUT_MS } from "../builtins";

export async function createOllamaProviderModule(
	config: GatewayResolvedProviderConfig,
	context: GatewayProviderContext,
): Promise<ProviderFactoryResult> {
	// An API key is only needed for Ollama Cloud (ollama.com); local servers
	// accept unauthenticated requests, so a missing key is not an error.
	// `ai-sdk-ollama` turns `apiKey` into an `Authorization: Bearer` header.
	const apiKey = await resolveApiKey(config);
	const baseURL = normalizeOllamaBaseUrl(config.baseUrl);
	const provider = createOllama({
		...(baseURL ? { baseURL } : {}),
		...(apiKey ? { apiKey } : {}),
		...(config.headers ? { headers: config.headers } : {}),
		// The response-start timeout is already applied to `config.fetch` by
		// the shared AI SDK stream path (with the Ollama-specific default).
		fetch: ensureFetch(config.fetch),
	});
	const numCtx = readOllamaNumCtx(context);
	return {
		// `splitToolImagesMiddleware` for the same reason as the
		// OpenAI-compatible vendor: the downstream converter stringifies
		// multimodal tool-result content, losing image bytes.
		model: (modelId) =>
			wrapLanguageModel({
				model: provider(modelId, {
					options: { num_ctx: numCtx },
				}) as LanguageModelV3,
				middleware: splitToolImagesMiddleware,
			}),
	};
}
