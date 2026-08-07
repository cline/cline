import { describe, expect, it } from "vitest";
import {
	buildProviderModelCatalog,
	isChatModel,
	isDedicatedTranscriptionModel,
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
		const catalog = buildProviderModelCatalog([elevenLabs], selection);
		expect(catalog.enabledProviderIds).toEqual([]);
		expect(catalog.providerModels.elevenlabs).toEqual([]);
		expect(catalog.voiceInput).toMatchObject({
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
});
