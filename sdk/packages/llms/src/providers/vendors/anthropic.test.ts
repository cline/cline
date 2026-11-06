import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUILTIN_PROVIDER_MANIFESTS_BY_ID } from "../builtins";
import { createAnthropicProviderModule } from "./anthropic";

const createAnthropicMock = vi.hoisted(() => vi.fn());
const anthropicModelMock = vi.hoisted(() =>
	vi.fn((modelId: string) => ({ provider: "anthropic", modelId })),
);

vi.mock("@ai-sdk/anthropic", () => ({
	createAnthropic: createAnthropicMock,
}));

describe("createAnthropicProviderModule", () => {
	beforeEach(() => {
		createAnthropicMock.mockReset();
		createAnthropicMock.mockReturnValue(anthropicModelMock);
		anthropicModelMock.mockClear();
	});

	it.each([
		["https://proxy.example", "https://proxy.example/v1"],
		[" https://proxy.example/ ", "https://proxy.example/v1"],
		["https://proxy.example/v1/", "https://proxy.example/v1/"],
		["https://proxy.example/custom", "https://proxy.example/custom"],
		[undefined, undefined],
		["", undefined],
		["   ", undefined],
		["not a URL", "not a URL"],
	])("resolves Anthropic base URL %s to %s", async (baseUrl, expected) => {
		const settings = config({ providerId: "anthropic", baseUrl });
		await createAnthropicProviderModule(settings, {
			...context("anthropic"),
			provider: BUILTIN_PROVIDER_MANIFESTS_BY_ID.anthropic,
		});

		expect(createAnthropicMock).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: expected }),
		);
		expect(settings.baseUrl).toBe(baseUrl);
	});

	it("preserves root URLs for providers without a default path policy", async () => {
		await createAnthropicProviderModule(
			config({
				providerId: "custom-anthropic",
				baseUrl: "https://proxy.example",
			}),
			context("custom-anthropic"),
		);

		expect(createAnthropicMock).toHaveBeenCalledWith(
			expect.objectContaining({ baseURL: "https://proxy.example" }),
		);
	});

	it("passes custom base URLs to Anthropic-compatible providers", async () => {
		const provider = await createAnthropicProviderModule(
			config({
				apiKey: "minimax-api-key",
				baseUrl: "https://api.minimax.io/anthropic",
			}),
			context("minimax"),
		);

		provider.operations.language("MiniMax-M2.5");

		expect(createAnthropicMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "minimax-api-key",
				baseURL: "https://api.minimax.io/anthropic",
				name: "minimax",
			}),
		);
		expect(anthropicModelMock).toHaveBeenCalledWith("MiniMax-M2.5");
	});

	it("does not wrap fetch for non-MiniMax Anthropic-compatible providers", async () => {
		const customFetch = vi.fn<typeof fetch>();

		await createAnthropicProviderModule(
			config({
				providerId: "anthropic",
				apiKey: "anthropic-api-key",
				fetch: customFetch,
			}),
			context("anthropic"),
		);

		expect(createAnthropicMock).toHaveBeenCalledWith(
			expect.objectContaining({
				name: "anthropic",
				fetch: customFetch,
			}),
		);
	});
});

function config(
	overrides: Partial<GatewayResolvedProviderConfig>,
): GatewayResolvedProviderConfig {
	return {
		providerId: "minimax",
		...overrides,
	};
}

function context(providerId: string): GatewayProviderContext {
	return {
		provider: {
			id: providerId,
			name: "MiniMax",
			defaultModelId: "MiniMax-M2.5",
			models: [],
		},
		model: {
			providerId,
			id: "MiniMax-M2.5",
			name: "MiniMax-M2.5",
		},
		config: config({ providerId }),
	};
}
