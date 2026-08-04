import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVertexProviderModule } from "./vertex";

const createVertexMock = vi.hoisted(() => vi.fn());
const createVertexAnthropicMock = vi.hoisted(() => vi.fn());
const vertexModelMock = vi.hoisted(() =>
	vi.fn((modelId: string) => ({ provider: "vertex", modelId })),
);
const vertexAnthropicModelMock = vi.hoisted(() =>
	vi.fn((modelId: string) => ({ provider: "vertex-anthropic", modelId })),
);

vi.mock("@ai-sdk/google-vertex", () => ({
	createVertex: createVertexMock,
}));

vi.mock("@ai-sdk/google-vertex/anthropic", () => ({
	createVertexAnthropic: createVertexAnthropicMock,
}));

describe("createVertexProviderModule", () => {
	beforeEach(() => {
		createVertexMock.mockReset();
		createVertexMock.mockReturnValue(vertexModelMock);
		createVertexAnthropicMock.mockReset();
		createVertexAnthropicMock.mockReturnValue(vertexAnthropicModelMock);
		vertexModelMock.mockClear();
		vertexAnthropicModelMock.mockClear();
	});

	it("passes providerConfig.gcp project settings as googleAuthOptions for Gemini models", async () => {
		await createVertexProviderModule(
			config({
				apiKey: "api-key-should-not-enable-express-mode",
				options: {
					project: "test-project",
					projectId: "test-project",
					location: "global",
					region: "global",
				},
			}),
			context("gemini-3-flash-preview"),
		);

		expect(createVertexMock).toHaveBeenCalledWith(
			expect.objectContaining({
				project: "test-project",
				location: "global",
				apiKey: undefined,
				googleAuthOptions: {
					projectId: "test-project",
				},
				fetch: expect.any(Function),
			}),
		);
		expect(createVertexAnthropicMock).not.toHaveBeenCalled();
	});

	it("accepts nested gcp project and region options", async () => {
		await createVertexProviderModule(
			config({
				options: {
					gcp: {
						projectId: "nested-project",
						region: "europe-west4",
					},
				},
			}),
			context("gemini-3-flash-preview"),
		);

		expect(createVertexMock).toHaveBeenCalledWith(
			expect.objectContaining({
				project: "nested-project",
				location: "europe-west4",
				googleAuthOptions: {
					projectId: "nested-project",
				},
			}),
		);
	});

	it("keeps API-key express mode when Gemini config has no GCP settings", async () => {
		await createVertexProviderModule(
			config({
				apiKey: "vertex-api-key",
			}),
			context("gemini-3-flash-preview"),
		);

		expect(createVertexMock).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "vertex-api-key",
				googleAuthOptions: undefined,
				fetch: expect.any(Function),
			}),
		);
	});

	it("continues routing Claude models through Vertex Anthropic", async () => {
		await createVertexProviderModule(
			config({
				options: {
					project: "test-project",
					location: "us-east5",
				},
			}),
			context("claude-sonnet-4-5@20250929"),
		);

		expect(createVertexAnthropicMock).toHaveBeenCalledWith(
			expect.objectContaining({
				project: "test-project",
				location: "us-east5",
			}),
		);
		expect(createVertexMock).not.toHaveBeenCalled();
	});
});

function config(
	overrides: Partial<GatewayResolvedProviderConfig>,
): GatewayResolvedProviderConfig {
	return {
		providerId: "vertex",
		...overrides,
	};
}

function context(modelId: string): GatewayProviderContext {
	return {
		provider: {
			id: "vertex",
			name: "Google Vertex AI",
			defaultModelId: modelId,
			models: [],
		},
		model: {
			providerId: "vertex",
			id: modelId,
			name: modelId,
		},
		config: config({}),
	};
}
