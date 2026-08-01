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

import type {
	LanguageModelV3,
	LanguageModelV3Middleware,
} from "@ai-sdk/provider";
import { APICallError } from "@ai-sdk/provider";
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
 * Time to wait for the response to start when no timeout is configured.
 * Matches the pre-SDK-migration Ollama handler default.
 */
export const OLLAMA_DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Read the configured request timeout, mirroring the legacy handler's
 * `requestTimeoutMs || 30000` (zero/invalid values fall back to the default).
 */
export function readOllamaTimeoutMs(
	config: GatewayResolvedProviderConfig,
): number {
	const timeoutMs = config.timeoutMs;
	if (
		typeof timeoutMs === "number" &&
		Number.isFinite(timeoutMs) &&
		timeoutMs > 0
	) {
		return Math.floor(timeoutMs);
	}
	return OLLAMA_DEFAULT_TIMEOUT_MS;
}

/**
 * Wrap a fetch so the *response* must start within `timeoutMs`. Once headers
 * arrive the timer is cleared — streaming the body is never interrupted.
 * Mirrors the legacy handler, which raced the chat call (stream start)
 * against a timeout rather than bounding the whole generation.
 *
 * A timeout rejects with a **retryable `APICallError`** so the AI SDK's
 * built-in `streamText` retry (default 2 retries with backoff) re-issues the
 * request. This matters for local servers: Ollama holds `/api/chat` open
 * while it cold-loads the model and only sends response headers once loading
 * finishes, so a large model routinely blows the response-start budget on the
 * first attempt. A timed-out attempt doesn't cancel the server-side load —
 * retrying converges on the loaded model, which is how the pre-SDK handler
 * (`withRetry({ retryAllErrors: true })`) rode out cold loads without ever
 * surfacing an error. Only OUR timer is converted: upstream aborts (user
 * cancellation) propagate untouched and stay non-retryable.
 */
export function withOllamaResponseTimeout(
	baseFetch: typeof fetch,
	timeoutMs: number,
): typeof fetch {
	return (async (input, init) => {
		const timeoutController = new AbortController();
		const timer = setTimeout(() => timeoutController.abort(), timeoutMs);
		// AbortSignal.any keeps upstream cancellation live for the entire
		// request (including body streaming after the timer is cleared) and
		// cleans up its own listeners — no manual listener management.
		const upstreamSignal = init?.signal;
		const signal = upstreamSignal
			? AbortSignal.any([upstreamSignal, timeoutController.signal])
			: timeoutController.signal;
		try {
			return await baseFetch(input, { ...init, signal });
		} catch (error) {
			// Convert only when our timer fired and the caller didn't abort
			// (checked instead of matching the thrown error because abort-reason
			// propagation differs across fetch implementations).
			if (timeoutController.signal.aborted && !upstreamSignal?.aborted) {
				throw new APICallError({
					message: `Ollama request timed out after ${timeoutMs / 1000} seconds`,
					url: typeof input === "string" ? input : String(input),
					requestBodyValues: {},
					isRetryable: true,
					cause: error,
				});
			}
			throw error;
		} finally {
			clearTimeout(timer);
		}
	}) as typeof fetch;
}

/**
 * Restore the innermost `APICallError` from an error's `cause` chain.
 *
 * `ai-sdk-ollama` wraps every `doStream`/`doGenerate` failure in its own
 * `OllamaError` (a plain `Error` subclass, original error as `cause`). The
 * AI SDK's retry predicate only retries `APICallError` instances with
 * `isRetryable === true`, so the wrapper would otherwise hide the retryable
 * timeout produced by {@link withOllamaResponseTimeout} and no retry would
 * ever happen. Returns the original error unchanged when no `APICallError`
 * is buried in the chain.
 */
export function restoreApiCallError(error: unknown): unknown {
	let candidate: unknown = error;
	for (let depth = 0; depth < 5 && candidate; depth++) {
		if (APICallError.isInstance(candidate)) {
			return candidate;
		}
		candidate = (candidate as { cause?: unknown }).cause;
	}
	return error;
}

/**
 * Middleware applying {@link restoreApiCallError} to model call failures, so
 * retryable errors reach the AI SDK retry loop as themselves rather than
 * wrapped in `OllamaError`.
 */
export const restoreOllamaApiCallErrorMiddleware: LanguageModelV3Middleware = {
	specificationVersion: "v3",
	wrapStream: async ({ doStream }) => {
		try {
			return await doStream();
		} catch (error) {
			throw restoreApiCallError(error);
		}
	},
	wrapGenerate: async ({ doGenerate }) => {
		try {
			return await doGenerate();
		} catch (error) {
			throw restoreApiCallError(error);
		}
	},
};

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
		fetch: withOllamaResponseTimeout(
			ensureFetch(config.fetch),
			readOllamaTimeoutMs(config),
		),
	});
	const numCtx = readOllamaNumCtx(context);
	return {
		// `restoreOllamaApiCallErrorMiddleware` so retryable response-start
		// timeouts survive ai-sdk-ollama's OllamaError wrapping and engage the
		// AI SDK retry loop. `splitToolImagesMiddleware` for the same reason as
		// the OpenAI-compatible vendor: the downstream converter stringifies
		// multimodal tool-result content, losing image bytes.
		model: (modelId) =>
			wrapLanguageModel({
				model: provider(modelId, {
					options: { num_ctx: numCtx },
				}) as LanguageModelV3,
				middleware: [
					restoreOllamaApiCallErrorMiddleware,
					splitToolImagesMiddleware,
				],
			}),
	};
}
