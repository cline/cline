import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleProviderModule, normalizeGeminiBaseUrl } from "./google";

const createGoogleGenerativeAIMock = vi.hoisted(() => vi.fn());
const googleModelMock = vi.hoisted(() =>
	vi.fn((modelId: string) => ({ provider: "google", modelId })),
);

vi.mock("@ai-sdk/google", () => ({
	createGoogleGenerativeAI: createGoogleGenerativeAIMock,
}));

describe("normalizeGeminiBaseUrl", () => {
	it("returns undefined when no base URL is configured", () => {
		expect(normalizeGeminiBaseUrl(undefined)).toBeUndefined();
		expect(normalizeGeminiBaseUrl("")).toBeUndefined();
		expect(normalizeGeminiBaseUrl("   ")).toBeUndefined();
	});

	it("appends /v1beta to host-root base URLs (legacy geminiBaseUrl semantics)", () => {
		expect(
			normalizeGeminiBaseUrl("https://generativelanguage.googleapis.com"),
		).toBe("https://generativelanguage.googleapis.com/v1beta");
		expect(normalizeGeminiBaseUrl("http://localhost:4000/gemini")).toBe(
			"http://localhost:4000/gemini/v1beta",
		);
	});

	it("strips trailing slashes before appending the version segment", () => {
		expect(normalizeGeminiBaseUrl("https://proxy.example/gemini///")).toBe(
			"https://proxy.example/gemini/v1beta",
		);
	});

	it("keeps base URLs that already end with an API version segment", () => {
		expect(
			normalizeGeminiBaseUrl(
				"https://generativelanguage.googleapis.com/v1beta",
			),
		).toBe("https://generativelanguage.googleapis.com/v1beta");
		expect(
			normalizeGeminiBaseUrl("https://proxy.example/gemini/v1alpha/"),
		).toBe("https://proxy.example/gemini/v1alpha");
		expect(normalizeGeminiBaseUrl("https://proxy.example/v1")).toBe(
			"https://proxy.example/v1",
		);
	});
});

describe("createGoogleProviderModule", () => {
	beforeEach(() => {
		createGoogleGenerativeAIMock.mockReset();
		createGoogleGenerativeAIMock.mockReturnValue(googleModelMock);
		googleModelMock.mockClear();
	});

	it("passes custom base URLs to the Google provider", async () => {
		const provider = await createGoogleProviderModule(
			config({ baseUrl: "https://gemini-proxy.example.com/v1beta" }),
			context(),
		);

		provider.operations.language("gemini-2.5-pro");

		expect(createGoogleGenerativeAIMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "test-api-key",
				baseURL: "https://gemini-proxy.example.com/v1beta",
				name: "gemini",
			}),
		);
		expect(googleModelMock).toHaveBeenCalledWith("gemini-2.5-pro");
	});

	it("normalizes host-root base URLs before passing them to the Google provider", async () => {
		await createGoogleProviderModule(
			config({ baseUrl: "http://localhost:4000/gemini" }),
			context(),
		);

		expect(createGoogleGenerativeAIMock).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: "http://localhost:4000/gemini/v1beta",
			}),
		);
	});

	it("keeps the Google provider default when no base URL is configured", async () => {
		await createGoogleProviderModule(config(), context());

		expect(createGoogleGenerativeAIMock).toHaveBeenCalledWith(
			expect.objectContaining({
				baseURL: undefined,
			}),
		);
	});
});

function config(
	overrides: Partial<GatewayResolvedProviderConfig> = {},
): GatewayResolvedProviderConfig {
	return {
		providerId: "gemini",
		apiKey: "test-api-key",
		...overrides,
	};
}

function context(): GatewayProviderContext {
	return {
		provider: {
			id: "gemini",
			name: "Google Gemini",
			defaultModelId: "gemini-2.5-pro",
			models: [],
		},
		model: {
			providerId: "gemini",
			id: "gemini-2.5-pro",
			name: "Gemini 2.5 Pro",
		},
		config: config(),
	};
}
