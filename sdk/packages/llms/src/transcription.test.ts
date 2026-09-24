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
	transcribe: transcribeMock,
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
			transport: "openai-native",
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
		transcribeMock.mockImplementationOnce(
			(await vi.importActual<typeof import("ai")>("ai")).transcribe,
		);
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
				audio: Buffer.from("RIFF0000WAVE").toString("base64"),
				mediaType: "audio/wav",
				providerOptions: {},
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
				audio: Buffer.from("RIFF0000WAVE"),
				maxRetries: 0,
			}),
		).resolves.toEqual({
			text: "gateway transcript",
			segments: [],
			warnings: [],
			language: "en",
			durationInSeconds: 1.5,
		});

		expect(fetchImpl).toHaveBeenCalledOnce();
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
			transport: "vercel-ai-gateway",
			modelId: "openai/gpt-realtime-whisper",
			baseUrl: "https://ai-gateway.vercel.sh/v4/ai",
			sampleRate: 24_000,
			token: "vcst_short_lived",
			url: "wss://ai-gateway.vercel.sh/v4/ai/transcription-model?ai-model-id=openai%2Fgpt-realtime-whisper",
			expiresAt: 1_800_000_000,
		});
	});

	it("selects 16 kHz PCM for Google live transcription", async () => {
		const session = await createStreamingAudioTranscriptionSession({
			providerConfig: {
				providerId: "vercel-ai-gateway",
				modelId: "",
				apiKey: "secret",
				fetch: vi.fn(async () => Response.json({ token: "short-lived" })),
			},
			modelId: "google/gemini-3.5-transcribe-live",
		});
		expect(session.sampleRate).toBe(16_000);
	});

	it("mints a single-use ElevenLabs credential for live transcription", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
			expect(input).toBe(
				"https://api.elevenlabs.test/v1/single-use-token/realtime_scribe",
			);
			expect(init?.method).toBe("POST");
			expect(new Headers(init?.headers).get("xi-api-key")).toBe(
				"eleven-secret",
			);
			return Response.json({ token: "single-use" });
		});
		const session = await createStreamingAudioTranscriptionSession({
			providerConfig: {
				providerId: "elevenlabs",
				modelId: "",
				apiKey: "eleven-secret",
				baseUrl: "https://api.elevenlabs.test/v1",
				fetch: fetchImpl,
			},
			modelId: "scribe_v2_realtime",
		});
		expect(session).toEqual({
			transport: "elevenlabs",
			sampleRate: 24_000,
			token: "single-use",
			url: "wss://api.elevenlabs.test/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_24000&commit_strategy=manual",
		});
		expect(JSON.stringify(session)).not.toContain("eleven-secret");
	});

	it.each([
		[401, { detail: { message: "Invalid key" } }, "Invalid key"],
		[200, {}, "returned no token"],
	])("rejects ElevenLabs session setup failures (%s)", async (status, body, message) => {
		await expect(
			createStreamingAudioTranscriptionSession({
				providerConfig: {
					providerId: "elevenlabs",
					modelId: "",
					apiKey: "secret",
					fetch: vi.fn(async () => Response.json(body, { status })),
				},
				modelId: "scribe_v2_realtime",
			}),
		).rejects.toThrow(message);
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
				audio: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]),
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

describe("native OpenAI streaming sessions", () => {
	it("mints a transcription-bound ephemeral token without exposing the API key", async () => {
		const fetchMock = vi.fn(async () =>
			Response.json({ value: "ek_short", expires_at: 1234 }),
		);
		const session = await createStreamingAudioTranscriptionSession({
			providerConfig: {
				providerId: "openai-native",
				modelId: "",
				apiKey: "secret",
				baseUrl: "https://openai.test/v1",
				fetch: fetchMock as unknown as typeof fetch,
			},
			modelId: "gpt-realtime-whisper",
		});
		expect(session).toMatchObject({
			transport: "openai-native",
			token: "ek_short",
			modelId: "gpt-realtime-whisper",
			baseUrl: "https://openai.test/v1",
			sampleRate: 24000,
		});
		expect(JSON.stringify(session)).not.toContain("secret");
		const [url, init] = fetchMock.mock.calls[0] as unknown as [
			string,
			RequestInit,
		];
		expect(url).toBe("https://openai.test/v1/realtime/client_secrets");
		expect(new Headers(init.headers).get("Authorization")).toBe(
			"Bearer secret",
		);
		expect(JSON.parse(String(init.body))).toMatchObject({
			session: {
				type: "transcription",
				audio: {
					input: {
						transcription: { model: "gpt-realtime-whisper" },
						turn_detection: null,
					},
				},
			},
			expires_after: { anchor: "created_at", seconds: 60 },
		});
	});
	it.each([
		Response.json({}, { status: 401 }),
		Response.json({}),
	])("rejects failed or malformed token responses", async (response) => {
		await expect(
			createStreamingAudioTranscriptionSession({
				providerConfig: {
					providerId: "openai-native",
					modelId: "",
					apiKey: "secret",
					fetch: (async () => response) as typeof fetch,
				},
				modelId: "gpt-realtime-whisper",
			}),
		).rejects.toThrow();
	});
});
