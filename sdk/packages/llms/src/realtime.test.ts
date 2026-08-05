import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createRealtimeVoiceSession,
	resolveRealtimeProviderTransport,
	resolveVercelAIGatewayBaseUrl,
} from "./realtime";

const mocks = vi.hoisted(() => ({
	gatewayFactory: vi.fn(),
	googleFactory: vi.fn(),
	openAiFactory: vi.fn(),
	getToken: vi.fn(),
}));

vi.mock("@ai-sdk/gateway", () => ({
	createGateway: (options: unknown) => {
		mocks.gatewayFactory(options);
		return { experimental_realtime: { getToken: mocks.getToken } };
	},
}));

vi.mock("@ai-sdk/google", () => ({
	createGoogle: (options: unknown) => {
		mocks.googleFactory(options);
		return { experimental_realtime: { getToken: mocks.getToken } };
	},
}));

vi.mock("@ai-sdk/openai", () => ({
	createOpenAI: (options: unknown) => {
		mocks.openAiFactory(options);
		return { experimental_realtime: { getToken: mocks.getToken } };
	},
}));

describe("realtime voice sessions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getToken.mockResolvedValue({
			token: "ephemeral-token",
			url: "wss://realtime.example.test/session",
			expiresAt: 1_785_280_000,
		});
	});

	it("normalizes legacy Vercel gateway endpoints to the AI SDK v7 route", () => {
		expect(resolveVercelAIGatewayBaseUrl(undefined)).toBe(
			"https://ai-gateway.vercel.sh/v4/ai",
		);
		expect(
			resolveVercelAIGatewayBaseUrl("https://ai-gateway.vercel.sh/v1"),
		).toBe("https://ai-gateway.vercel.sh/v4/ai");
		expect(resolveVercelAIGatewayBaseUrl("https://gateway.example.test")).toBe(
			"https://gateway.example.test/v4/ai",
		);
	});

	it("maps configured provider families onto supported realtime transports", () => {
		expect(
			resolveRealtimeProviderTransport({
				providerId: "custom-google",
				routingProviderId: "gemini",
			}),
		).toBe("google");
		expect(
			resolveRealtimeProviderTransport({ providerId: "openai-native" }),
		).toBe("openai");
		expect(() =>
			resolveRealtimeProviderTransport({ providerId: "anthropic" }),
		).toThrow("does not have an AI SDK realtime transport");
	});

	it("mints a provider-bound gateway token without exposing the API key", async () => {
		const session = await createRealtimeVoiceSession({
			providerConfig: {
				providerId: "vercel-ai-gateway",
				modelId: "openai/gpt-realtime",
				apiKey: "gateway-secret",
				baseUrl: "https://ai-gateway.vercel.sh/v1",
			},
			modelId: "openai/gpt-realtime",
			voice: " alloy ",
		});

		expect(mocks.gatewayFactory).toHaveBeenCalledWith(
			expect.objectContaining({
				apiKey: "gateway-secret",
				baseURL: "https://ai-gateway.vercel.sh/v4/ai",
			}),
		);
		expect(mocks.getToken).toHaveBeenCalledWith({
			model: "openai/gpt-realtime",
			expiresAfterSeconds: 300,
			sessionConfig: {
				instructions:
					"You are the speech transport for the Cline coding agent. Never answer the user or call tools on your own. User speech is handled by Cline, which owns conversation context, tools, approvals, and persistence. Only speak when explicitly given a completed Cline response to read aloud. Read that response faithfully without adding analysis, answers, or claims of your own.",
				outputModalities: ["audio"],
				inputAudioTranscription: {},
				outputAudioTranscription: {},
				voice: "alloy",
				turnDetection: {
					type: "server-vad",
					prefixPaddingMs: 300,
					silenceDurationMs: 650,
				},
			},
		});
		expect(session).toEqual({
			token: "ephemeral-token",
			url: "wss://realtime.example.test/session",
			expiresAt: 1_785_280_000,
			transport: "vercel-ai-gateway",
			sessionConfig: expect.objectContaining({ voice: "alloy" }),
		});
		expect(JSON.stringify(session)).not.toContain("gateway-secret");
	});

	it("rejects missing credentials and overlong browser sessions", async () => {
		await expect(
			createRealtimeVoiceSession({
				providerConfig: {
					providerId: "openai-native",
					modelId: "gpt-realtime",
				},
				modelId: "gpt-realtime",
			}),
		).rejects.toThrow("missing credentials");
		await expect(
			createRealtimeVoiceSession({
				providerConfig: {
					providerId: "openai-native",
					modelId: "gpt-realtime",
					apiKey: "secret",
				},
				modelId: "gpt-realtime",
				expiresAfterSeconds: 301,
			}),
		).rejects.toThrow("between 1 and 300 seconds");
	});
});
