import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createOllamaProviderModule,
	normalizeOllamaBaseUrl,
	OLLAMA_DEFAULT_NUM_CTX,
	OLLAMA_DEFAULT_TIMEOUT_MS,
	readOllamaNumCtx,
	readOllamaThink,
	readOllamaTimeoutMs,
	withOllamaResponseTimeout,
} from "./ollama";

const createOllamaMock = vi.hoisted(() => vi.fn());
const ollamaModelMock = vi.hoisted(() =>
	vi.fn((modelId: string, _settings?: unknown) => ({
		specificationVersion: "v4",
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

	it("defaults to 5 minutes so model cold loads don't hit a timeout error", () => {
		// Ollama only sends response headers once the model is loaded, so the
		// response-start budget must cover a cold load (cline/cline#12829).
		expect(OLLAMA_DEFAULT_TIMEOUT_MS).toBe(300_000);
	});
});

describe("readOllamaThink", () => {
	it("enables think for a model with the reasoning capability", () => {
		const ctx = context({ capabilities: ["text", "reasoning"] });
		expect(readOllamaThink(ctx, request({}))).toBe(true);
		expect(
			readOllamaThink(ctx, request({ reasoning: { enabled: true } })),
		).toBe(true);
	});

	it("enables think for a model whose reasoning defaults on per metadata", () => {
		const ctx = context({ metadata: { reasoningDefaultOn: true } });
		expect(readOllamaThink(ctx, request({}))).toBe(true);
	});

	it("enables think via the documented qwen3 model-id fallback", () => {
		expect(
			readOllamaThink(context({}), request({ modelId: "qwen3:0.6b" })),
		).toBe(true);
	});

	it("disables think when the request disables reasoning", () => {
		expect(
			readOllamaThink(
				context({ capabilities: ["text", "reasoning"] }),
				request({ reasoning: { enabled: false } }),
			),
		).toBe(false);
	});

	it("omits think when thinking capability is unknown", () => {
		expect(readOllamaThink(context({}), request({}))).toBeUndefined();
		// Even a disable request stays silent: sending `think` to a model
		// that does not support thinking is an Ollama error.
		expect(
			readOllamaThink(context({}), request({ reasoning: { enabled: false } })),
		).toBeUndefined();
	});

	it("omits think when metadata says reasoning does not default on", () => {
		// Explicit metadata beats the qwen3 model-id fallback.
		expect(
			readOllamaThink(
				context({ metadata: { reasoningDefaultOn: false } }),
				request({ modelId: "qwen3-coder:30b" }),
			),
		).toBeUndefined();
	});

	it("falls back to the resolved model when no request is given", () => {
		expect(readOllamaThink(context({ id: "qwen3:0.6b" }))).toBe(true);
		expect(readOllamaThink(context({}))).toBeUndefined();
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

	it("requests think for a reasoning-capable model (cline/cline#12829)", async () => {
		const provider = await createOllamaProviderModule(
			config({}),
			context({ id: "qwen3:0.6b", capabilities: ["text", "reasoning"] }),
			request({ modelId: "qwen3:0.6b" }),
		);
		provider.model("qwen3:0.6b");

		expect(ollamaModelMock).toHaveBeenCalledWith("qwen3:0.6b", {
			options: { num_ctx: OLLAMA_DEFAULT_NUM_CTX },
			think: true,
		});
	});

	it("requests think=false when the request disables reasoning", async () => {
		const provider = await createOllamaProviderModule(
			config({}),
			context({ id: "qwen3:0.6b", capabilities: ["text", "reasoning"] }),
			request({ modelId: "qwen3:0.6b", reasoning: { enabled: false } }),
		);
		provider.model("qwen3:0.6b");

		expect(ollamaModelMock).toHaveBeenCalledWith("qwen3:0.6b", {
			options: { num_ctx: OLLAMA_DEFAULT_NUM_CTX },
			think: false,
		});
	});

	it("omits think when thinking capability is unknown", async () => {
		const provider = await createOllamaProviderModule(
			config({}),
			context({ id: "llama3.1" }),
			request({ modelId: "llama3.1" }),
		);
		provider.model("llama3.1");

		expect(ollamaModelMock).toHaveBeenCalledWith("llama3.1", {
			options: { num_ctx: OLLAMA_DEFAULT_NUM_CTX },
		});
	});
});

function config(
	overrides: Partial<GatewayResolvedProviderConfig>,
): GatewayResolvedProviderConfig {
	return {
		providerId: "ollama",
		...overrides,
	};
}

function request(
	overrides: Partial<GatewayStreamRequest>,
): GatewayStreamRequest {
	return {
		providerId: "ollama",
		modelId: "minimax-m3:cloud",
		messages: [],
		...overrides,
	} as GatewayStreamRequest;
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
