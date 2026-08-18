import { beforeEach, describe, expect, it, vi } from "vitest";

const { createOpenAIMock, generateSpeechMock, openAISpeechModel } = vi.hoisted(
	() => {
		const openAISpeechModel = {
			provider: "openai",
			specificationVersion: "v3",
		};
		return {
			createOpenAIMock: vi.fn(() => ({
				speech: vi.fn(() => openAISpeechModel),
			})),
			generateSpeechMock: vi.fn(),
			openAISpeechModel,
		};
	},
);

vi.mock("@ai-sdk/openai", () => ({
	createOpenAI: createOpenAIMock,
}));
vi.mock("ai", () => ({
	experimental_generateSpeech: generateSpeechMock,
}));

import { generateSpeechAudio, resolveSpeechGenerationRoute } from "./speech";

describe("generateSpeechAudio", () => {
	beforeEach(() => {
		createOpenAIMock.mockClear();
		generateSpeechMock.mockReset().mockResolvedValue({
			audio: {
				uint8Array: new Uint8Array([7, 8, 9]),
				mediaType: "audio/mpeg",
			},
		});
	});

	it("resolves provider-specific speech generation routes", () => {
		expect(
			resolveSpeechGenerationRoute({
				providerId: "vercel-ai-gateway",
				baseUrl: "https://ai-gateway.vercel.sh/v1/",
			}),
		).toEqual({
			kind: "vercel-ai-gateway",
			baseUrl: "https://ai-gateway.vercel.sh/v4/ai",
			endpoint: "https://ai-gateway.vercel.sh/v4/ai/speech-model",
		});
		expect(
			resolveSpeechGenerationRoute({
				providerId: "gemini",
				baseUrl: "https://generativelanguage.googleapis.com/v1beta/",
			}),
		).toMatchObject({
			kind: "gemini",
			endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
		});
		expect(
			resolveSpeechGenerationRoute({
				providerId: "elevenlabs",
				baseUrl: "https://api.elevenlabs.io/v1/",
			}),
		).toMatchObject({
			kind: "elevenlabs",
			endpoint: "https://api.elevenlabs.io/v1/text-to-speech",
		});
	});

	it("uses Vercel AI Gateway's native speech model transport", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			expect(input).toBe("https://ai-gateway.vercel.sh/v4/ai/speech-model");
			const headers = new Headers(init?.headers);
			expect(headers.get("authorization")).toBe("Bearer gateway-secret");
			expect(headers.get("ai-gateway-protocol-version")).toBe("0.0.1");
			expect(headers.get("ai-speech-model-specification-version")).toBe("4");
			expect(headers.get("ai-model-id")).toBe("openai/tts-1");
			expect(JSON.parse(String(init?.body))).toEqual({
				text: "Read this aloud",
				voice: "alloy",
				outputFormat: "mp3",
			});
			return new Response(JSON.stringify({ audio: "AQID" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		});

		await expect(
			generateSpeechAudio({
				providerConfig: {
					providerId: "vercel-ai-gateway",
					modelId: "chat-model",
					apiKey: "gateway-secret",
					baseUrl: "https://ai-gateway.vercel.sh/v1",
					fetch: fetchImpl,
				},
				modelId: "openai/tts-1",
				text: "Read this aloud",
				voice: "alloy",
			}),
		).resolves.toEqual({
			audio: new Uint8Array([1, 2, 3]),
			mediaType: "audio/mpeg",
		});
		expect(generateSpeechMock).not.toHaveBeenCalled();
	});

	it("uses ElevenLabs' native text-to-speech endpoint and voice ID", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			expect(input).toBe(
				"https://api.elevenlabs.test/v1/text-to-speech/voice-123",
			);
			const headers = new Headers(init?.headers);
			expect(headers.get("xi-api-key")).toBe("eleven-secret");
			expect(JSON.parse(String(init?.body))).toEqual({
				text: "Hello ElevenLabs",
				model_id: "eleven_turbo_v2_5",
			});
			return new Response(new Uint8Array([4, 5, 6]), {
				status: 200,
				headers: { "content-type": "audio/mpeg" },
			});
		});

		await expect(
			generateSpeechAudio({
				providerConfig: {
					providerId: "elevenlabs",
					modelId: "scribe_v2",
					apiKey: "eleven-secret",
					baseUrl: "https://api.elevenlabs.test/v1",
					fetch: fetchImpl,
				},
				modelId: "eleven_turbo_v2_5",
				text: "Hello ElevenLabs",
				voice: "voice-123",
			}),
		).resolves.toEqual({
			audio: new Uint8Array([4, 5, 6]),
			mediaType: "audio/mpeg",
		});
	});

	it("generates Gemini audio and wraps raw PCM in a WAV container", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			expect(input).toBe(
				"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
			);
			const headers = new Headers(init?.headers);
			expect(headers.get("x-goog-api-key")).toBe("gemini-secret");
			expect(JSON.parse(String(init?.body))).toEqual({
				contents: [{ parts: [{ text: "Hello Gemini" }] }],
				generationConfig: {
					responseModalities: ["AUDIO"],
					speechConfig: {
						voiceConfig: {
							prebuiltVoiceConfig: { voiceName: "Kore" },
						},
					},
				},
			});
			return new Response(
				JSON.stringify({
					candidates: [
						{
							content: {
								parts: [
									{
										inlineData: {
											data: "AQIDBA==",
											mimeType: "audio/L16;rate=24000",
										},
									},
								],
							},
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});

		const result = await generateSpeechAudio({
			providerConfig: {
				providerId: "gemini",
				modelId: "chat-model",
				apiKey: "gemini-secret",
				fetch: fetchImpl,
			},
			modelId: "gemini-2.5-flash-preview-tts",
			text: "Hello Gemini",
			voice: "Kore",
		});
		expect(result.mediaType).toBe("audio/wav");
		expect(Buffer.from(result.audio.subarray(0, 4)).toString("ascii")).toBe(
			"RIFF",
		);
		expect(Buffer.from(result.audio.subarray(8, 12)).toString("ascii")).toBe(
			"WAVE",
		);
		expect(result.audio.subarray(44)).toEqual(new Uint8Array([1, 2, 3, 4]));
	});

	it("uses the AI SDK speech model for OpenAI-compatible providers", async () => {
		await expect(
			generateSpeechAudio({
				providerConfig: {
					providerId: "openai-native",
					modelId: "chat-model",
					apiKey: "openai-secret",
					baseUrl: "https://api.openai.test/v1",
				},
				modelId: "tts-1",
				text: "Hello OpenAI",
				voice: "alloy",
				maxRetries: 0,
			}),
		).resolves.toEqual({
			audio: new Uint8Array([7, 8, 9]),
			mediaType: "audio/mpeg",
		});
		expect(generateSpeechMock).toHaveBeenCalledWith(
			expect.objectContaining({
				model: openAISpeechModel,
				text: "Hello OpenAI",
				voice: "alloy",
				outputFormat: "mp3",
				maxRetries: 0,
				abortSignal: expect.any(AbortSignal),
			}),
		);
	});
});
