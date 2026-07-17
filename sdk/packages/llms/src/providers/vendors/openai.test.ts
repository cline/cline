import type {
	GatewayResolvedProviderConfig,
	GatewayStreamRequest,
} from "@cline/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createOpenAIProviderModule } from "./openai";

const createOpenAIMock = vi.hoisted(() => vi.fn());
const responsesModelMock = vi.hoisted(() =>
	vi.fn((modelId: string) => ({ provider: "openai", modelId })),
);

vi.mock("@ai-sdk/openai", () => ({
	createOpenAI: createOpenAIMock,
}));

describe("createOpenAIProviderModule", () => {
	beforeEach(() => {
		createOpenAIMock.mockReset();
		createOpenAIMock.mockReturnValue({
			responses: responsesModelMock,
		});
		responsesModelMock.mockClear();
	});

	it("forwards maxOutputTokens for explicit caps from direct callers", async () => {
		const provider = await createOpenAIProviderModule(config(), context());

		const streamConfig = provider.buildStreamConfig?.(
			request({ maxTokens: 8_192 }),
			context(),
		);

		expect(streamConfig?.maxOutputTokens).toBe(8_192);
	});

	it("forwards maxOutputTokens for gateway-resolved explicit caps", async () => {
		const provider = await createOpenAIProviderModule(config(), context());

		const streamConfig = provider.buildStreamConfig?.(
			request({ maxTokens: 8_192, defaultedMaxTokens: false }),
			context(),
		);

		expect(streamConfig?.maxOutputTokens).toBe(8_192);
	});

	it("drops gateway-synthesized default caps", async () => {
		const provider = await createOpenAIProviderModule(config(), context());

		const streamConfig = provider.buildStreamConfig?.(
			request({ maxTokens: 32_000, defaultedMaxTokens: true }),
			context(),
		);

		expect(streamConfig).not.toHaveProperty("maxOutputTokens");
	});

	it("drops explicit caps for the ChatGPT OAuth backend", async () => {
		const provider = await createOpenAIProviderModule(
			config({ baseUrl: "https://chatgpt.com/backend-api/codex" }),
			context(),
		);

		const streamConfig = provider.buildStreamConfig?.(
			request({ maxTokens: 8_192 }),
			context(),
		);

		expect(streamConfig).not.toHaveProperty("maxOutputTokens");
	});

	it("does not treat non-chatgpt.com hosts containing 'chatgpt.com' as OAuth", async () => {
		for (const baseUrl of [
			"https://example.com/chatgpt.com",
			"https://chatgpt.com.example.com/v1",
			"https://notchatgpt.com/v1",
		]) {
			const provider = await createOpenAIProviderModule(
				config({ baseUrl }),
				context(),
			);

			const streamConfig = provider.buildStreamConfig?.(
				request({ maxTokens: 8_192 }),
				context(),
			);

			expect(streamConfig?.maxOutputTokens).toBe(8_192);
		}
	});
});

function config(
	overrides: Partial<GatewayResolvedProviderConfig> = {},
): GatewayResolvedProviderConfig {
	return {
		providerId: "openai-native",
		apiKey: "test-api-key",
		...overrides,
	};
}

function context() {
	return {
		provider: {
			id: "openai-native",
			name: "OpenAI",
			defaultModelId: "gpt-5-mini",
			models: [],
		},
		model: {
			providerId: "openai-native",
			id: "gpt-5-mini",
			name: "gpt-5-mini",
		},
		config: config(),
	};
}

function request(
	overrides: Partial<GatewayStreamRequest>,
): GatewayStreamRequest {
	return {
		providerId: "openai-native",
		modelId: "gpt-5-mini",
		messages: [],
		...overrides,
	};
}
