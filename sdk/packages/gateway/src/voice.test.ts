import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { GatewayGlobalSettingsStore } from "./global-settings";
import { resolveGatewayPaths } from "./paths";
import { GatewayProviderSettingsStore } from "./provider-settings";
import { tempDataRoot } from "./test-support";
import {
	GatewayVoiceError,
	GatewayVoiceManager,
	type GatewayVoicePrimitives,
} from "./voice";

function createVoiceManager(options: {
	providerId: string;
	modelId: string;
	apiKey?: string;
	env?: Record<string, string | undefined>;
	primitives?: Partial<GatewayVoicePrimitives>;
	maxAudioBytes?: number;
}) {
	const dataRoot = tempDataRoot("gateway-voice-");
	const providerSettings = new GatewayProviderSettingsStore({
		filePath: join(dataRoot, "providers.json"),
	});
	providerSettings.patch(options.providerId, {
		enabled: true,
		settings: {
			model: options.modelId,
			...(options.apiKey ? { apiKey: options.apiKey } : {}),
		},
	});
	const globalSettings = new GatewayGlobalSettingsStore({
		filePath: join(dataRoot, "settings.json"),
	});
	const transcribe = vi.fn(
		async (
			_request: Parameters<GatewayVoicePrimitives["transcribeAudio"]>[0],
		) => ({
			text: "hello from audio",
			language: "en",
		}),
	);
	const createStreaming = vi.fn(
		async (
			_request: Parameters<
				GatewayVoicePrimitives["createStreamingAudioTranscriptionSession"]
			>[0],
		) => ({
			token: "short-lived-token",
			url: "wss://voice.example.test/transcription",
			expiresAt: 123,
		}),
	);
	const primitives: GatewayVoicePrimitives = {
		transcribeAudio: options.primitives?.transcribeAudio ?? transcribe,
		createStreamingAudioTranscriptionSession:
			options.primitives?.createStreamingAudioTranscriptionSession ??
			createStreaming,
	};
	return {
		providerSettings,
		globalSettings,
		transcribe,
		createStreaming,
		manager: new GatewayVoiceManager({
			paths: resolveGatewayPaths({ dataRoot, namespace: "desktop" }),
			providerSettings,
			globalSettings,
			env: options.env ?? {},
			primitives,
			maxAudioBytes: options.maxAudioBytes,
		}),
	};
}

describe("GatewayVoiceManager", () => {
	it("persists a validated batch selection and keeps provider credentials inside Gateway", async () => {
		const { manager, globalSettings, transcribe } = createVoiceManager({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
			apiKey: "stored-voice-secret",
			env: { ELEVENLABS_API_KEY: "environment-voice-secret" },
		});

		expect(
			await manager.setSelection({
				providerId: "elevenlabs",
				modelId: "scribe_v2",
			}),
		).toEqual({
			voiceInput: { providerId: "elevenlabs", modelId: "scribe_v2" },
		});
		expect(globalSettings.get().voiceInput).toEqual({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
		});

		await expect(
			manager.transcribe({
				audioBase64: Buffer.from("recorded audio").toString("base64"),
				mediaType: "audio/webm;codecs=opus",
			}),
		).resolves.toEqual({ text: "hello from audio", language: "en" });
		expect(transcribe).toHaveBeenCalledOnce();
		const request = transcribe.mock.calls[0]?.[0];
		expect(request).toMatchObject({
			modelId: "scribe_v2",
			mediaType: "audio/webm;codecs=opus",
			maxRetries: 0,
			providerConfig: {
				providerId: "elevenlabs",
				apiKey: "environment-voice-secret",
			},
		});
	});

	it("mints streaming sessions only for a streaming transcription model", async () => {
		const { manager, createStreaming } = createVoiceManager({
			providerId: "vercel-ai-gateway",
			modelId: "openai/gpt-realtime-whisper",
			apiKey: "vercel-voice-secret",
		});
		await manager.setSelection({
			providerId: "vercel-ai-gateway",
			modelId: "openai/gpt-realtime-whisper",
		});

		await expect(manager.createStreamingSession()).resolves.toEqual({
			token: "short-lived-token",
			url: "wss://voice.example.test/transcription",
			expiresAt: 123,
		});
		expect(createStreaming).toHaveBeenCalledWith(
			expect.objectContaining({
				modelId: "openai/gpt-realtime-whisper",
				expiresAfterSeconds: 300,
				providerConfig: expect.objectContaining({
					apiKey: "vercel-voice-secret",
				}),
			}),
		);
	});

	it("rejects invalid and oversized audio before calling the provider", async () => {
		const { manager, transcribe } = createVoiceManager({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
			apiKey: "voice-secret",
			maxAudioBytes: 3,
		});
		await manager.setSelection({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
		});

		await expect(
			manager.transcribe({ audioBase64: "not base64" }),
		).rejects.toBeInstanceOf(GatewayVoiceError);
		await expect(
			manager.transcribe({
				audioBase64: Buffer.from("four").toString("base64"),
			}),
		).rejects.toThrow("valid base64");
		expect(transcribe).not.toHaveBeenCalled();
	});

	it("never returns a raw provider response or credential in diagnostics", async () => {
		const secret = "voice-secret-that-must-not-leak";
		const rawProviderBody = `unauthorized api_key=${secret}`;
		const { manager } = createVoiceManager({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
			apiKey: secret,
			primitives: {
				transcribeAudio: vi.fn(async () => {
					throw new Error(rawProviderBody);
				}),
			},
		});
		await manager.setSelection({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
		});

		let caught: unknown;
		try {
			await manager.transcribe({
				audioBase64: Buffer.from("audio").toString("base64"),
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(GatewayVoiceError);
		expect(String(caught)).toContain("Check the provider credential");
		expect(String(caught)).not.toContain(secret);
		expect(String(caught)).not.toContain(rawProviderBody);
	});

	it("clears a saved selection and rejects disabled providers", async () => {
		const { manager, providerSettings, globalSettings } = createVoiceManager({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
			apiKey: "voice-secret",
		});
		await manager.setSelection({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
		});
		providerSettings.patch("elevenlabs", { enabled: false });

		await expect(
			manager.transcribe({
				audioBase64: Buffer.from("audio").toString("base64"),
			}),
		).rejects.toThrow("is not enabled");
		expect(await manager.setSelection(undefined)).toEqual({});
		expect(globalSettings.get().voiceInput).toBeUndefined();
	});
});
