import { APICallError } from "@ai-sdk/provider";
import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createOllamaProviderModule,
	normalizeOllamaBaseUrl,
	OLLAMA_DEFAULT_NUM_CTX,
	OLLAMA_DEFAULT_TIMEOUT_MS,
	readOllamaNumCtx,
	readOllamaTimeoutMs,
	restoreApiCallError,
	restoreOllamaApiCallErrorMiddleware,
	withOllamaResponseTimeout,
} from "./ollama";

const createOllamaMock = vi.hoisted(() => vi.fn());
const ollamaModelMock = vi.hoisted(() =>
	vi.fn((modelId: string, _settings?: unknown) => ({
		specificationVersion: "v3",
		provider: "ollama",
		modelId,
	})),
);

vi.mock("ai-sdk-ollama", () => ({
	createOllama: createOllamaMock,
}));

describe("normalizeOllamaBaseUrl", () => {
	it("passes a bare origin through (the ollama client appends /api itself)", () => {
		expect(normalizeOllamaBaseUrl("http://localhost:11434")).toBe(
			"http://localhost:11434",
		);
		expect(normalizeOllamaBaseUrl("https://ollama.com")).toBe(
			"https://ollama.com",
		);
	});

	it("strips a legacy OpenAI-compat /v1 suffix", () => {
		expect(normalizeOllamaBaseUrl("http://localhost:11434/v1")).toBe(
			"http://localhost:11434",
		);
	});

	it("strips a native-API /api suffix", () => {
		expect(normalizeOllamaBaseUrl("http://localhost:11434/api")).toBe(
			"http://localhost:11434",
		);
	});

	it("strips trailing slashes", () => {
		expect(normalizeOllamaBaseUrl("http://localhost:11434/")).toBe(
			"http://localhost:11434",
		);
	});

	it("returns undefined for empty input", () => {
		expect(normalizeOllamaBaseUrl(undefined)).toBeUndefined();
		expect(normalizeOllamaBaseUrl("  ")).toBeUndefined();
	});
});

describe("readOllamaNumCtx", () => {
	it("reads the resolved model's context window", () => {
		expect(readOllamaNumCtx(context({ contextWindow: 500000 }))).toBe(500000);
	});

	it("falls back to maxInputTokens when contextWindow is absent", () => {
		expect(readOllamaNumCtx(context({ maxInputTokens: 128000 }))).toBe(128000);
	});

	it("falls back to the default for missing or invalid values", () => {
		expect(readOllamaNumCtx(context({}))).toBe(OLLAMA_DEFAULT_NUM_CTX);
		expect(readOllamaNumCtx(context({ contextWindow: 0 }))).toBe(
			OLLAMA_DEFAULT_NUM_CTX,
		);
		expect(readOllamaNumCtx(context({ contextWindow: -1 }))).toBe(
			OLLAMA_DEFAULT_NUM_CTX,
		);
	});
});

describe("readOllamaTimeoutMs", () => {
	it("reads a configured timeout", () => {
		expect(readOllamaTimeoutMs(config({ timeoutMs: 180000 }))).toBe(180000);
	});

	it("falls back to the default for missing or invalid values", () => {
		expect(readOllamaTimeoutMs(config({}))).toBe(OLLAMA_DEFAULT_TIMEOUT_MS);
		expect(readOllamaTimeoutMs(config({ timeoutMs: 0 }))).toBe(
			OLLAMA_DEFAULT_TIMEOUT_MS,
		);
		expect(readOllamaTimeoutMs(config({ timeoutMs: -5 }))).toBe(
			OLLAMA_DEFAULT_TIMEOUT_MS,
		);
	});
});

describe("withOllamaResponseTimeout", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("aborts when the response does not start within the timeout", async () => {
		const hangingFetch = ((_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(init.signal?.reason),
				);
			})) as typeof fetch;

		const wrapped = withOllamaResponseTimeout(hangingFetch, 1000);
		const pending = wrapped("http://localhost:11434/api/chat");
		const assertion = expect(pending).rejects.toThrow(
			"Ollama request timed out after 1 seconds",
		);
		await vi.advanceTimersByTimeAsync(1001);
		await assertion;
	});

	it("rejects timeouts as retryable APICallErrors so the AI SDK retries them", async () => {
		const hangingFetch = ((_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(init.signal?.reason),
				);
			})) as typeof fetch;

		const wrapped = withOllamaResponseTimeout(hangingFetch, 1000);
		const pending = wrapped("http://localhost:11434/api/chat").catch(
			(error) => error,
		);
		await vi.advanceTimersByTimeAsync(1001);
		const error = await pending;

		expect(APICallError.isInstance(error)).toBe(true);
		expect((error as APICallError).isRetryable).toBe(true);
		expect((error as APICallError).url).toBe(
			"http://localhost:11434/api/chat",
		);
	});

	it("does not abort once the response has started", async () => {
		let requestSignal: AbortSignal | undefined;
		const immediateFetch = (async (_input, init) => {
			requestSignal = init?.signal ?? undefined;
			return new Response("ok");
		}) as typeof fetch;

		const wrapped = withOllamaResponseTimeout(immediateFetch, 1000);
		const response = await wrapped("http://localhost:11434/api/chat");
		await vi.advanceTimersByTimeAsync(5000);

		expect(response.ok).toBe(true);
		// Timer was cleared on response start — streaming continues unaborted.
		expect(requestSignal?.aborted).toBe(false);
	});

	it("propagates upstream aborts", async () => {
		const hangingFetch = ((_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(init.signal?.reason),
				);
			})) as typeof fetch;

		const upstream = new AbortController();
		const wrapped = withOllamaResponseTimeout(hangingFetch, 60_000);
		const pending = wrapped("http://localhost:11434/api/chat", {
			signal: upstream.signal,
		});
		const assertion = expect(pending).rejects.toThrow("user cancelled");
		upstream.abort(new Error("user cancelled"));
		await assertion;
	});

	it("does not convert upstream aborts into retryable errors", async () => {
		const hangingFetch = ((_input, init) =>
			new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () =>
					reject(init.signal?.reason),
				);
			})) as typeof fetch;

		const upstream = new AbortController();
		const wrapped = withOllamaResponseTimeout(hangingFetch, 60_000);
		const pending = wrapped("http://localhost:11434/api/chat", {
			signal: upstream.signal,
		}).catch((error) => error);
		upstream.abort(new Error("user cancelled"));
		const error = await pending;

		expect(APICallError.isInstance(error)).toBe(false);
		expect((error as Error).message).toBe("user cancelled");
	});
});

describe("restoreApiCallError", () => {
	it("returns a bare APICallError as-is", () => {
		const apiError = retryableApiCallError();
		expect(restoreApiCallError(apiError)).toBe(apiError);
	});

	it("restores an APICallError buried in a cause chain (OllamaError wrapping)", () => {
		const apiError = retryableApiCallError();
		const wrapped = new Error("Ollama request failed", { cause: apiError });
		expect(restoreApiCallError(wrapped)).toBe(apiError);
	});

	it("returns the original error when no APICallError is present", () => {
		const plain = new Error("connection refused");
		expect(restoreApiCallError(plain)).toBe(plain);
	});

	it("handles non-Error values", () => {
		expect(restoreApiCallError("boom")).toBe("boom");
		expect(restoreApiCallError(undefined)).toBeUndefined();
	});
});

describe("restoreOllamaApiCallErrorMiddleware", () => {
	it("rethrows the buried APICallError from wrapStream failures", async () => {
		const apiError = retryableApiCallError();
		const doStream = vi
			.fn()
			.mockRejectedValue(new Error("wrapped", { cause: apiError }));

		await expect(
			restoreOllamaApiCallErrorMiddleware.wrapStream?.({
				doStream,
			} as never),
		).rejects.toBe(apiError);
	});

	it("passes successful streams through untouched", async () => {
		const result = { stream: "stream" };
		const doStream = vi.fn().mockResolvedValue(result);

		await expect(
			restoreOllamaApiCallErrorMiddleware.wrapStream?.({
				doStream,
			} as never),
		).resolves.toBe(result);
	});
});

describe("createOllamaProviderModule", () => {
	beforeEach(() => {
		createOllamaMock.mockReset();
		createOllamaMock.mockReturnValue(ollamaModelMock);
		ollamaModelMock.mockClear();
	});

	it("normalizes the base URL and passes the API key through", async () => {
		const provider = await createOllamaProviderModule(
			config({ baseUrl: "https://ollama.com/v1", apiKey: "ollama-key" }),
			context({}),
		);
		provider.model("minimax-m3:cloud");

		expect(createOllamaMock).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://ollama.com",
				apiKey: "ollama-key",
			}),
		);
		expect(ollamaModelMock).toHaveBeenCalledWith(
			"minimax-m3:cloud",
			expect.anything(),
		);
	});

	it("requests num_ctx from the resolved model's context window", async () => {
		const provider = await createOllamaProviderModule(
			config({}),
			context({ contextWindow: 65536 }),
		);
		provider.model("qwen3-coder:30b");

		expect(ollamaModelMock).toHaveBeenCalledWith("qwen3-coder:30b", {
			options: { num_ctx: 65536 },
		});
	});

	it("requests the default num_ctx when the model has no context window", async () => {
		const provider = await createOllamaProviderModule(config({}), context({}));
		provider.model("llama3.1");

		expect(ollamaModelMock).toHaveBeenCalledWith("llama3.1", {
			options: { num_ctx: OLLAMA_DEFAULT_NUM_CTX },
		});
	});

	it("omits baseURL and apiKey for a default local server", async () => {
		await createOllamaProviderModule(config({}), context({}));

		const call = createOllamaMock.mock.calls[0][0];
		expect(call.baseURL).toBeUndefined();
		expect(call.apiKey).toBeUndefined();
	});
});

function retryableApiCallError(): APICallError {
	return new APICallError({
		message: "Ollama request timed out after 30 seconds",
		url: "http://localhost:11434/api/chat",
		requestBodyValues: {},
		isRetryable: true,
	});
}

function config(
	overrides: Partial<GatewayResolvedProviderConfig>,
): GatewayResolvedProviderConfig {
	return {
		providerId: "ollama",
		...overrides,
	};
}

function context(model: Record<string, unknown> = {}): GatewayProviderContext {
	return {
		provider: {
			id: "ollama",
			name: "Ollama",
			defaultModelId: "",
			models: [],
		},
		model: {
			id: "minimax-m3:cloud",
			name: "minimax-m3:cloud",
			providerId: "ollama",
			...model,
		},
	} as unknown as GatewayProviderContext;
}
