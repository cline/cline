import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createOllamaProviderModule,
	normalizeOllamaBaseUrl,
	OLLAMA_DEFAULT_TIMEOUT_MS,
	readOllamaTimeoutMs,
	withOllamaResponseTimeout,
} from "./ollama";

const createOllamaMock = vi.hoisted(() => vi.fn());
const ollamaModelMock = vi.hoisted(() =>
	vi.fn((modelId: string) => ({
		specificationVersion: "v4",
		provider: "ollama",
		modelId,
	})),
);

vi.mock("ollama-ai-provider-v2", () => ({
	createOllama: createOllamaMock,
}));

describe("normalizeOllamaBaseUrl", () => {
	it("appends the native API root to a bare origin", () => {
		expect(normalizeOllamaBaseUrl("http://localhost:11434")).toBe(
			"http://localhost:11434/api",
		);
		expect(normalizeOllamaBaseUrl("https://ollama.com")).toBe(
			"https://ollama.com/api",
		);
	});

	it("strips a legacy OpenAI-compat /v1 suffix", () => {
		expect(normalizeOllamaBaseUrl("http://localhost:11434/v1")).toBe(
			"http://localhost:11434/api",
		);
	});

	it("strips a native-API /api suffix", () => {
		expect(normalizeOllamaBaseUrl("http://localhost:11434/api")).toBe(
			"http://localhost:11434/api",
		);
	});

	it("strips trailing slashes", () => {
		expect(normalizeOllamaBaseUrl("http://localhost:11434/")).toBe(
			"http://localhost:11434/api",
		);
	});

	it("returns undefined for empty input", () => {
		expect(normalizeOllamaBaseUrl(undefined)).toBeUndefined();
		expect(normalizeOllamaBaseUrl("  ")).toBeUndefined();
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
		createOllamaMock.mockReturnValue({ chat: ollamaModelMock });
		ollamaModelMock.mockClear();
	});

	it("normalizes the base URL and passes the API key through", async () => {
		const provider = await createOllamaProviderModule(
			config({ baseUrl: "https://ollama.com/v1", apiKey: "ollama-key" }),
			context({}),
		);
		provider.operations.language("minimax-m3:cloud");

		expect(createOllamaMock).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "https://ollama.com/api",
				headers: { Authorization: "Bearer ollama-key" },
				compatibility: "strict",
			}),
		);
		expect(ollamaModelMock).toHaveBeenCalledWith("minimax-m3:cloud");
	});

	it("constructs a native chat model without request-scoped settings", async () => {
		const provider = await createOllamaProviderModule(
			config({}),
			context({ contextWindow: 65536 }),
		);
		provider.operations.language("qwen3-coder:30b");

		expect(ollamaModelMock).toHaveBeenCalledWith("qwen3-coder:30b");
	});

	it("omits baseURL and authorization headers for a default local server", async () => {
		await createOllamaProviderModule(config({}), context({}));

		const call = createOllamaMock.mock.calls[0][0];
		expect(call.baseURL).toBeUndefined();
		expect(call.headers).toBeUndefined();
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
