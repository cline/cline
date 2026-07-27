import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createOllamaProviderModule,
	normalizeOllamaBaseUrl,
	OLLAMA_DEFAULT_NUM_CTX,
	readOllamaNumCtx,
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

	it("passes the configured fetch through unwrapped", async () => {
		// The shared AI SDK stream path already wraps `config.fetch` with the
		// response-start timeout, so the vendor must not wrap it again.
		const customFetch = vi.fn<typeof fetch>();
		await createOllamaProviderModule(
			config({ fetch: customFetch }),
			context({}),
		);

		const call = createOllamaMock.mock.calls[0][0];
		expect(call.fetch).toBe(customFetch);
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
