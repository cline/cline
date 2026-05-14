import type {
	GatewayProviderContext,
	GatewayResolvedProviderConfig,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVertexProviderModule } from "./vertex";

const vertexMock = vi.hoisted(() => ({
	createVertex: vi.fn(() => (modelId: string) => ({ modelId })),
	createVertexAnthropic: vi.fn(() => (modelId: string) => ({ modelId })),
}));

vi.mock("@ai-sdk/google-vertex", () => ({
	createVertex: vertexMock.createVertex,
}));

vi.mock("@ai-sdk/google-vertex/anthropic", () => ({
	createVertexAnthropic: vertexMock.createVertexAnthropic,
}));

const context = {
	model: {
		id: "gemini-3-flash-preview",
	},
} as GatewayProviderContext;

describe("createVertexProviderModule", () => {
	beforeEach(() => {
		vertexMock.createVertex.mockClear();
		vertexMock.createVertexAnthropic.mockClear();
	});

	it("uses ADC by default instead of resolving project environment variables as API keys", async () => {
		await createVertexProviderModule(
			{
				providerId: "vertex",
				apiKeyEnv: [
					"GCP_PROJECT_ID",
					"GOOGLE_CLOUD_PROJECT",
					"GOOGLE_APPLICATION_CREDENTIALS",
				],
				options: {
					project: "test-project",
					location: "global",
				},
			} as GatewayResolvedProviderConfig,
			context,
		);

		const options = vertexMock.createVertex.mock.calls[0][0];
		expect(options).toMatchObject({
			project: "test-project",
			location: "global",
		});
		expect(options.fetch).toBe(globalThis.fetch);
		expect(
			options.googleAuthOptions.clientOptions.transporterOptions
				.fetchImplementation,
		).toBe(globalThis.fetch);
		expect(options).not.toHaveProperty("apiKey");
	});

	it("still forwards an explicitly configured Vertex API key", async () => {
		await createVertexProviderModule(
			{
				providerId: "vertex",
				apiKey: " explicit-key ",
				options: {
					project: "test-project",
					location: "global",
				},
			} as GatewayResolvedProviderConfig,
			context,
		);

		expect(vertexMock.createVertex.mock.calls[0][0]).toMatchObject({
			apiKey: "explicit-key",
		});
	});

	it("uses the configured fetch implementation for Vertex requests and ADC token refreshes", async () => {
		const customFetch = vi.fn() as unknown as typeof fetch;

		await createVertexProviderModule(
			{
				providerId: "vertex",
				fetch: customFetch,
				options: {
					project: "test-project",
					location: "global",
				},
			} as GatewayResolvedProviderConfig,
			context,
		);

		const options = vertexMock.createVertex.mock.calls[0][0];
		expect(options.fetch).toBe(customFetch);
		expect(
			options.googleAuthOptions.clientOptions.transporterOptions
				.fetchImplementation,
		).toBe(customFetch);
	});

	it("preserves an explicitly configured Google auth fetch implementation", async () => {
		const configuredFetch = vi.fn() as unknown as typeof fetch;
		const runtimeFetch = vi.fn() as unknown as typeof fetch;

		await createVertexProviderModule(
			{
				providerId: "vertex",
				fetch: runtimeFetch,
				options: {
					project: "test-project",
					location: "global",
					googleAuthOptions: {
						clientOptions: {
							transporterOptions: {
								fetchImplementation: configuredFetch,
							},
						},
					},
				},
			} as GatewayResolvedProviderConfig,
			context,
		);

		const options = vertexMock.createVertex.mock.calls[0][0];
		expect(options.fetch).toBe(runtimeFetch);
		expect(
			options.googleAuthOptions.clientOptions.transporterOptions
				.fetchImplementation,
		).toBe(configuredFetch);
	});
});
