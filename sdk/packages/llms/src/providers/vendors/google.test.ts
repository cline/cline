import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createGoogleProviderModule } from "./google";

const createGoogleGenerativeAIMock = vi.hoisted(() => vi.fn());
const googleModelMock = vi.hoisted(() =>
	vi.fn((modelId: string) => ({ provider: "google", modelId })),
);

vi.mock("@ai-sdk/google", () => ({
	createGoogleGenerativeAI: createGoogleGenerativeAIMock,
}));

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

		provider.model("gemini-2.5-pro");

		expect(createGoogleGenerativeAIMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "test-api-key",
				baseURL: "https://gemini-proxy.example.com/v1beta",
				name: "gemini",
			}),
		);
		expect(googleModelMock).toHaveBeenCalledWith("gemini-2.5-pro");
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
