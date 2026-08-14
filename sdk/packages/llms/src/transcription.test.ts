import { beforeEach, describe, expect, it, vi } from "vitest";

const { createOpenAIMock, openAITranscriptionModel, transcribeMock } =
	vi.hoisted(() => {
		const openAITranscriptionModel = {
			provider: "openai",
			specificationVersion: "v3",
		};
		return {
			createOpenAIMock: vi.fn(() => ({
				transcription: vi.fn(() => openAITranscriptionModel),
			})),
			openAITranscriptionModel,
			transcribeMock: vi.fn(),
		};
	});

vi.mock("@ai-sdk/openai", () => ({
	createOpenAI: createOpenAIMock,
}));
vi.mock("ai", () => ({
	experimental_transcribe: transcribeMock,
}));

import {
	createStreamingAudioTranscriptionSession,
	resolveAudioTranscriptionRoute,
	transcribeAudio,
} from "./transcription";

describe("transcribeAudio", () => {
	beforeEach(() => {
		createOpenAIMock.mockClear();
		transcribeMock.mockReset().mockResolvedValue({
			text: "hello world",
			language: "en",
			durationInSeconds: 1.5,
		});
	});

	it("resolves provider-specific transcription routes", () => {
		expect(
			resolveAudioTranscriptionRoute({
				providerId: "vercel-ai-gateway",
				baseUrl: "https://ai-gateway.vercel.sh/v1/",
			}),
		).toEqual({
			transport: "vercel-ai-gateway",
			baseUrl: "https://ai-gateway.vercel.sh/v4/ai",
			endpoint: "https://ai-gateway.vercel.sh/v4/ai/transcription-model",
		});
		expect(
			resolveAudioTranscriptionRoute({
				providerId: "elevenlabs",
				baseUrl: "https://api.elevenlabs.io/v1/",
			}),
		).toMatchObject({
			transport: "elevenlabs",
			endpoint: "https://api.elevenlabs.io/v1/speech-to-text",
		});
		expect(
			resolveAudioTranscriptionRoute({
				providerId: "groq",
				baseUrl: "https://api.groq.com/openai/v1/",
			}),
		).toMatchObject({
			transport: "openai-compatible",
			endpoint: "https://api.groq.com/openai/v1/audio/transcriptions",
		});
		expect(
			resolveAudioTranscriptionRoute({
				providerId: "custom-audio",
				routingProviderId: "openai-native",
				baseUrl: "https://audio.example/v1/",
			}),
		).toMatchObject({
			transport: "openai-compatible",
			endpoint: "https://audio.example/v1/audio/transcriptions",
		});
	});

	it("rejects providers without an explicit transcription transport", () => {
		expect(() =>
			resolveAudioTranscriptionRoute({
				providerId: "openai",
				baseUrl: "https://compatible.example/v1",
			}),
		).toThrow('Provider "openai" does not declare a transcription operation');
	});

	it("uses provider credentials, endpoint, headers, and the selected model", async () => {
		const fetchImpl = vi.fn<typeof fetch>();
		await expect(
			transcribeAudio({
				providerConfig: {
					providerId: "groq",
					modelId: "chat-model",
					apiKey: "secret",
					baseUrl: "https://api.groq.test/openai/v1",
					headers: { "X-Test": "value" },
					timeoutMs: 5_000,
					fetch: fetchImpl,
				},
				modelId: "whisper-large-v3-turbo",
				audio: new Uint8Array([1, 2, 3]),
				maxRetries: 0,
			}),
		).resolves.toEqual({
			text: "hello world",
			language: "en",
			durationInSeconds: 1.5,
		});

		expect(createOpenAIMock).toHaveBeenCalledWith({
			apiKey: "secret",
			baseURL: "https://api.groq.test/openai/v1",
			fetch: fetchImpl,
			headers: { "X-Test": "value" },
		});
		expect(transcribeMock).toHaveBeenCalledWith(
			expect.objectContaining({
				model: openAITranscriptionModel,
				audio: new Uint8Array([1, 2, 3]),
				maxRetries: 0,
				abortSignal: expect.any(AbortSignal),
			}),
		);
	});

	it("uses Vercel AI Gateway's native transcription model transport", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			expect(input).toBe(
				"https://ai-gateway.vercel.sh/v4/ai/transcription-model",
			);
			const headers = new Headers(init?.headers);
			expect(headers.get("authorization")).toBe("Bearer gateway-secret");
			expect(headers.get("ai-gateway-protocol-version")).toBe("0.0.1");
			expect(headers.get("ai-gateway-auth-method")).toBe("api-key");
			expect(headers.get("ai-transcription-model-specification-version")).toBe(
				"4",
			);
			expect(headers.get("ai-model-id")).toBe("openai/whisper-1");
			expect(headers.get("content-type")).toBe("application/json");
			expect(JSON.parse(String(init?.body))).toEqual({
				audio: "AQID",
				mediaType: "audio/mp4",
			});
			return new Response(
				JSON.stringify({
					text: "gateway transcript",
					language: "en",
					durationInSeconds: 1.5,
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		await expect(
			transcribeAudio({
				providerConfig: {
					providerId: "vercel-ai-gateway",
					modelId: "chat-model",
					apiKey: "gateway-secret",
					baseUrl: "https://ai-gateway.vercel.sh/v1",
					headers: { "X-Test": "value" },
					fetch: fetchImpl,
				},
				modelId: "openai/whisper-1",
				audio: new Uint8Array([1, 2, 3]),
				mediaType: "audio/mp4; codecs=mp4a.40.2",
				maxRetries: 0,
			}),
		).resolves.toEqual({
			text: "gateway transcript",
			language: "en",
			durationInSeconds: 1.5,
		});

		expect(fetchImpl).toHaveBeenCalledOnce();
		expect(transcribeMock).not.toHaveBeenCalled();
		expect(createOpenAIMock).not.toHaveBeenCalled();
	});

	it("mints a short-lived Vercel streaming transcription session", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			expect(input).toBe(
				"https://ai-gateway.vercel.sh/v1/realtime/client-secrets",
			);
			const headers = new Headers(init?.headers);
			expect(headers.get("authorization")).toBe("Bearer gateway-secret");
			expect(headers.get("ai-gateway-protocol-version")).toBe("0.0.1");
			expect(headers.get("ai-gateway-auth-method")).toBe("api-key");
			expect(JSON.parse(String(init?.body))).toEqual({
				model: "openai/gpt-realtime-whisper",
				routeKind: "transcription",
				expiresIn: 120,
			});
			return new Response(
				JSON.stringify({
					token: "vcst_short_lived",
					expiresAt: 1_800_000_000,
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});

		await expect(
			createStreamingAudioTranscriptionSession({
				providerConfig: {
					providerId: "vercel-ai-gateway",
					modelId: "chat-model",
					apiKey: "gateway-secret",
					baseUrl: "https://ai-gateway.vercel.sh/v1",
					fetch: fetchImpl,
				},
				modelId: "openai/gpt-realtime-whisper",
				expiresAfterSeconds: 120,
			}),
		).resolves.toEqual({
			token: "vcst_short_lived",
			url: "wss://ai-gateway.vercel.sh/v4/ai/transcription-model?ai-model-id=openai%2Fgpt-realtime-whisper",
			expiresAt: 1_800_000_000,
		});
	});

	it("uses ElevenLabs' native speech-to-text endpoint", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			expect(input).toBe("https://api.elevenlabs.test/v1/speech-to-text");
			const headers = new Headers(init?.headers);
			expect(headers.get("xi-api-key")).toBe("eleven-secret");
			expect(headers.get("content-type")).toBeNull();

			const body = init?.body;
			expect(body).toBeInstanceOf(FormData);
			const formData = body as FormData;
			expect(formData.get("model_id")).toBe("scribe_v2");
			const file = formData.get("file");
			expect(file).toBeInstanceOf(Blob);
			expect((file as Blob).type).toBe("audio/webm");

			return new Response(
				JSON.stringify({
					text: "native ElevenLabs transcript",
					language_code: "eng",
				}),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});

		await expect(
			transcribeAudio({
				providerConfig: {
					providerId: "elevenlabs",
					modelId: "scribe_v2",
					apiKey: "eleven-secret",
					baseUrl: "https://api.elevenlabs.test/v1/",
					headers: { "content-type": "application/json" },
					fetch: fetchImpl,
				},
				modelId: "scribe_v2",
				audio: new Uint8Array([1, 2, 3]),
				mediaType: "audio/webm;codecs=opus",
			}),
		).resolves.toEqual({
			text: "native ElevenLabs transcript",
			language: "eng",
		});
		expect(createOpenAIMock).not.toHaveBeenCalled();
	});

	it("rejects empty audio and missing credentials before making a request", async () => {
		await expect(
			transcribeAudio({
				providerConfig: {
					providerId: "groq",
					modelId: "chat-model",
					apiKey: "secret",
				},
				modelId: "whisper-large-v3",
				audio: new Uint8Array(),
			}),
		).rejects.toThrow("Recorded audio is empty");

		await expect(
			transcribeAudio({
				providerConfig: {
					providerId: "groq",
					modelId: "chat-model",
				},
				modelId: "whisper-large-v3",
				audio: new Uint8Array([1]),
			}),
		).rejects.toThrow('Provider "groq" is missing credentials');
		expect(transcribeMock).not.toHaveBeenCalled();
	});
});
