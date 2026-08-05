import { describe, expect, it } from "vitest";
import {
	buildProviderModelCatalog,
	isChatModel,
	isDedicatedTranscriptionModel,
	isRealtimeVoiceModel,
	isSpeechGenerationModel,
	selectRealtimeVoiceModel,
	selectSpeechGenerationModel,
	selectTranscriptionModel,
	supportsAudio,
} from "./provider-model-catalog";
import type { Provider } from "./provider-schema";

describe("transcription model selection", () => {
	it("distinguishes speech-to-text from text-to-speech and chat audio", () => {
		expect(
			isDedicatedTranscriptionModel({
				id: "whisper",
				name: "Whisper",
				inputModalities: ["audio"],
				outputModalities: ["text"],
			}),
		).toBe(true);
		expect(
			isDedicatedTranscriptionModel({
				id: "elevenlabs",
				name: "ElevenLabs",
				inputModalities: ["text"],
				outputModalities: ["audio"],
			}),
		).toBe(false);
		expect(
			isDedicatedTranscriptionModel({
				id: "omni",
				name: "Omni",
				inputModalities: ["text", "audio"],
				outputModalities: ["text"],
			}),
		).toBe(false);
	});

	it("detects audio support in either modality direction", () => {
		expect(
			supportsAudio({
				id: "transcription",
				name: "Transcription",
				inputModalities: ["audio"],
				outputModalities: ["text"],
			}),
		).toBe(true);
		expect(
			supportsAudio({
				id: "speech",
				name: "Speech",
				inputModalities: ["text"],
				outputModalities: ["audio"],
			}),
		).toBe(true);
		expect(
			supportsAudio({
				id: "text",
				name: "Text",
				inputModalities: ["text"],
				outputModalities: ["text"],
			}),
		).toBe(false);
	});

	it("selects dedicated text-to-audio models for voice playback", () => {
		const provider: Provider = {
			id: "gemini",
			name: "Google Gemini",
			models: 1,
			color: "#000000",
			letter: "GG",
			enabled: true,
			modelList: [
				{
					id: "gemini-2.5-flash-preview-tts",
					name: "Gemini 2.5 Flash Preview TTS",
					inputModalities: ["text"],
					outputModalities: ["audio"],
				},
			],
		};
		expect(provider.modelList?.[0]).toBeDefined();
		expect(
			provider.modelList?.[0]
				? isSpeechGenerationModel(provider.modelList[0])
				: false,
		).toBe(true);
		expect(
			selectSpeechGenerationModel([provider], {
				providerId: "gemini",
				modelId: "gemini-2.5-flash-preview-tts",
				voice: "Kore",
			}),
		).toEqual({
			providerId: "gemini",
			providerName: "Google Gemini",
			modelId: "gemini-2.5-flash-preview-tts",
			modelName: "Gemini 2.5 Flash Preview TTS",
			voice: "Kore",
		});
	});

	it("keeps audio utility models out of the chat model selector", () => {
		expect(
			isChatModel({
				id: "chat",
				name: "Chat",
				inputModalities: ["text", "audio"],
				outputModalities: ["text"],
			}),
		).toBe(true);
		expect(
			isChatModel({
				id: "whisper",
				name: "Whisper",
				inputModalities: ["audio"],
				outputModalities: ["text"],
			}),
		).toBe(false);
		expect(
			isChatModel({
				id: "tts",
				name: "TTS",
				inputModalities: ["text"],
				outputModalities: ["audio"],
			}),
		).toBe(false);
		expect(
			isChatModel({
				id: "imagen",
				name: "Imagen",
				inputModalities: ["text"],
				outputModalities: ["image"],
			}),
		).toBe(true);
	});

	it("selects only the explicitly configured enabled model", () => {
		const providers: Provider[] = [
			{
				id: "groq",
				name: "Groq",
				models: 1,
				color: "#000000",
				letter: "GR",
				enabled: true,
				modelList: [
					{
						id: "whisper-large-v3",
						name: "Whisper",
						inputModalities: ["audio"],
						outputModalities: ["text"],
					},
				],
			},
			{
				id: "nvidia",
				name: "Nvidia",
				models: 1,
				color: "#000000",
				letter: "NV",
				enabled: true,
				modelList: [
					{
						id: "whisper-large-v3",
						name: "Whisper",
						inputModalities: ["audio"],
						outputModalities: ["text"],
					},
				],
			},
		];

		expect(
			selectTranscriptionModel(providers, {
				providerId: "nvidia",
				modelId: "whisper-large-v3",
			}),
		).toEqual({
			providerId: "nvidia",
			providerName: "Nvidia",
			modelId: "whisper-large-v3",
			modelName: "Whisper",
			supportsStreaming: false,
		});
		expect(selectTranscriptionModel(providers, undefined)).toBeNull();
	});

	it("keeps an enabled audio-only provider out of the chat provider list", () => {
		const elevenLabs: Provider = {
			id: "elevenlabs",
			name: "ElevenLabs",
			models: 1,
			color: "#000000",
			letter: "EL",
			enabled: true,
			modelList: [
				{
					id: "scribe_v2",
					name: "Scribe v2",
					inputModalities: ["audio"],
					outputModalities: ["text"],
				},
			],
		};

		const selection = {
			providerId: "elevenlabs",
			modelId: "scribe_v2",
		};
		const catalog = buildProviderModelCatalog([elevenLabs], {
			voiceInput: selection,
		});
		expect(catalog.enabledProviderIds).toEqual([]);
		expect(catalog.providerModels.elevenlabs).toEqual([]);
		expect(catalog.modes.voiceInput).toMatchObject({
			providerId: "elevenlabs",
			modelId: "scribe_v2",
			supportsStreaming: false,
		});
	});

	it("preserves streaming transcription capability for the composer", () => {
		const provider: Provider = {
			id: "vercel-ai-gateway",
			name: "Vercel AI Gateway",
			models: 1,
			color: "#000000",
			letter: "VA",
			enabled: true,
			modelList: [
				{
					id: "openai/gpt-realtime-whisper",
					name: "GPT Realtime Whisper",
					supportsStreamingTranscription: true,
					inputModalities: ["audio"],
					outputModalities: ["text"],
				},
			],
		};

		expect(
			selectTranscriptionModel([provider], {
				providerId: provider.id,
				modelId: "openai/gpt-realtime-whisper",
			}),
		).toMatchObject({ supportsStreaming: true });
	});

	it("selects configured live audio models only on realtime transports", () => {
		const gemini: Provider = {
			id: "gemini",
			name: "Google Gemini",
			models: 1,
			color: "#000000",
			letter: "GG",
			enabled: true,
			modelList: [
				{
					id: "gemini-3.5-live-translate-preview",
					name: "Gemini 3.5 Live Translate Preview",
					supportsTools: true,
					inputModalities: ["audio"],
					outputModalities: ["audio", "text"],
				},
			],
		};
		const unsupportedTransport = {
			...gemini,
			id: "custom-audio",
			name: "Custom Audio",
		};
		const liveModel = gemini.modelList?.[0];
		expect(liveModel).toBeDefined();
		if (!liveModel) throw new Error("Missing realtime model fixture");

		expect(isRealtimeVoiceModel(liveModel)).toBe(true);
		expect(
			selectRealtimeVoiceModel([gemini], {
				providerId: "gemini",
				modelId: "gemini-3.5-live-translate-preview",
				voice: "Kore",
			}),
		).toEqual({
			providerId: "gemini",
			providerName: "Google Gemini",
			modelId: "gemini-3.5-live-translate-preview",
			modelName: "Gemini 3.5 Live Translate Preview",
			supportsTools: true,
			voice: "Kore",
		});
		expect(
			selectRealtimeVoiceModel([unsupportedTransport], {
				providerId: "custom-audio",
				modelId: "gemini-3.5-live-translate-preview",
			}),
		).toBeNull();
	});
});
